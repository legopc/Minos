mod common;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, HeaderMap, Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use std::net::SocketAddr;
use tower::ServiceExt;

async fn send_raw(
    app: &axum::Router,
    method: Method,
    uri: &str,
    bearer: Option<&str>,
    content_type: Option<&str>,
    body: Body,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(bearer) = bearer {
        req = req.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
    }
    if let Some(content_type) = content_type {
        req = req.header(header::CONTENT_TYPE, content_type);
    }
    let mut req = req.body(body).expect("request");
    req.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:9191".parse::<SocketAddr>().expect("socket addr"),
    ));

    let resp = app.clone().oneshot(req).await.expect("response");
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes()
        .to_vec();
    (status, headers, bytes)
}

#[tokio::test]
async fn audit_log_lists_scene_zone_and_route_mutations() {
    let (app, _state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, _scene) = common::post_json(
        &app,
        "/api/v1/scenes",
        serde_json::json!({"name":"scene-a","description":"Audit me"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, zone) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({"name":"Front Bar","tx_ids":["tx_0"]}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let zone_id = zone
        .get("id")
        .and_then(|v| v.as_str())
        .expect("zone id")
        .to_string();

    let (status, route) = common::post_json(
        &app,
        "/api/v1/routes",
        serde_json::json!({"rx_id":"rx_1","tx_id":"tx_0"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(route.get("id").and_then(|v| v.as_str()), Some("rx_1|tx_0"));

    let (status, json) = common::get_json(&app, "/api/v1/system/audit", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(3));

    let entries = json
        .get("entries")
        .and_then(|v| v.as_array())
        .expect("entries array");

    let scene_entry = entries
        .iter()
        .find(|entry| entry.get("action").and_then(|v| v.as_str()) == Some("scene.save"))
        .expect("scene.save entry");
    assert_eq!(
        scene_entry
            .pointer("/actor/username")
            .and_then(|v| v.as_str()),
        Some("admin-user")
    );
    assert_eq!(
        scene_entry
            .pointer("/resource/kind")
            .and_then(|v| v.as_str()),
        Some("scene")
    );

    let zone_entry = entries
        .iter()
        .find(|entry| entry.get("action").and_then(|v| v.as_str()) == Some("zone.create"))
        .expect("zone.create entry");
    assert_eq!(
        zone_entry.pointer("/resource/id").and_then(|v| v.as_str()),
        Some(zone_id.as_str())
    );
    assert_eq!(
        zone_entry
            .pointer("/context/tx_ids/0")
            .and_then(|v| v.as_str()),
        Some("tx_0")
    );

    let route_entry = entries
        .iter()
        .find(|entry| entry.get("action").and_then(|v| v.as_str()) == Some("route.create"))
        .expect("route.create entry");
    assert_eq!(
        route_entry.pointer("/resource/id").and_then(|v| v.as_str()),
        Some("rx_1|tx_0")
    );
    assert_eq!(
        route_entry
            .pointer("/context/route_type")
            .and_then(|v| v.as_str()),
        Some("dante")
    );
}

#[tokio::test]
async fn audit_export_downloads_json_and_includes_config_restore() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let mut cfg = state.config.read().await.clone();
    cfg.show_buses_in_mixer = true;
    let toml_body = toml::to_string_pretty(&cfg).expect("serialize config");

    let (status, _headers, _bytes) = send_raw(
        &app,
        Method::POST,
        "/api/v1/system/config/restore",
        Some(&tok),
        Some("application/toml"),
        Body::from(toml_body),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = common::get_json(&app, "/api/v1/system/audit", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let entries = json
        .get("entries")
        .and_then(|v| v.as_array())
        .expect("entries array");
    let restore_entry = entries
        .iter()
        .find(|entry| entry.get("action").and_then(|v| v.as_str()) == Some("system.config.restore"))
        .expect("config restore audit entry");
    assert_eq!(
        restore_entry
            .pointer("/context/source")
            .and_then(|v| v.as_str()),
        Some("restore")
    );

    let (status, headers, bytes) = send_raw(
        &app,
        Method::GET,
        "/api/v1/system/audit/export",
        Some(&tok),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/json")
    );
    let disposition = headers
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .expect("content disposition");
    assert!(disposition.starts_with("attachment; filename=\"patchbox-audit-"));

    let export: serde_json::Value = serde_json::from_slice(&bytes).expect("export json");
    assert_eq!(export.get("total").and_then(|v| v.as_u64()), Some(1));
    assert!(export.get("exported_at").and_then(|v| v.as_str()).is_some());
}
