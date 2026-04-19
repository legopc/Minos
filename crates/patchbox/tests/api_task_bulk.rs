mod common;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
};
use std::net::SocketAddr;
use tokio::sync::broadcast;
use tokio::time::{timeout, Duration};
use tower::ServiceExt;

async fn recv_task(receiver: &mut broadcast::Receiver<String>) -> serde_json::Value {
    for _ in 0..8 {
        let msg = timeout(Duration::from_secs(1), receiver.recv())
            .await
            .expect("task event timeout")
            .expect("broadcast event");
        let json: serde_json::Value = serde_json::from_str(&msg).expect("task json");
        if json.get("type").and_then(|value| value.as_str()) == Some("task") {
            return json;
        }
    }
    panic!("task event not received");
}

async fn post_toml(app: &axum::Router, uri: &str, bearer: &str, body: String) -> StatusCode {
    let mut req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(header::CONTENT_TYPE, "application/toml")
        .body(Body::from(body))
        .expect("request");
    req.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:9191".parse::<SocketAddr>().expect("socket addr"),
    ));

    app.clone().oneshot(req).await.expect("response").status()
}

#[tokio::test]
async fn scene_load_emits_task_updates() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, _) = common::post_json(
        &app,
        "/api/v1/scenes",
        serde_json::json!({"name":"scene-task","description":"task"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let mut receiver = state.ws_tx.subscribe();
    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/scene-task/load",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let started = recv_task(&mut receiver).await;
    let succeeded = recv_task(&mut receiver).await;

    assert_eq!(
        started.get("task_id").and_then(|v| v.as_str()),
        Some("scene:load:scene-task")
    );
    assert_eq!(
        started.get("status").and_then(|v| v.as_str()),
        Some("started")
    );
    assert_eq!(
        succeeded.get("status").and_then(|v| v.as_str()),
        Some("succeeded")
    );
}

#[tokio::test]
async fn recovery_action_emits_task_updates() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();
    let mut receiver = state.ws_tx.subscribe();

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/system/dante/recovery-actions/rescan",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let started = recv_task(&mut receiver).await;
    let succeeded = recv_task(&mut receiver).await;

    assert_eq!(
        started.get("task_id").and_then(|v| v.as_str()),
        Some("recovery:rescan")
    );
    assert_eq!(
        started.get("status").and_then(|v| v.as_str()),
        Some("started")
    );
    assert_eq!(
        succeeded.get("status").and_then(|v| v.as_str()),
        Some("succeeded")
    );
}

#[tokio::test]
async fn bulk_clear_zone_routes_applies_and_emits_task_updates() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, zone) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({"name":"Task Zone","tx_ids":["tx_0"]}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let zone_id = zone
        .get("id")
        .and_then(|v| v.as_str())
        .expect("zone id")
        .to_string();

    let (status, _route) = common::post_json(
        &app,
        "/api/v1/routes",
        serde_json::json!({"rx_id":"rx_1","tx_id":"tx_0"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let mut receiver = state.ws_tx.subscribe();
    let (status, json) = common::post_json(
        &app,
        "/api/v1/bulk",
        serde_json::json!({"operation":"clear_zone_routes","zone_id":zone_id}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("affected").and_then(|v| v.as_u64()), Some(1));

    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(routes.as_array().map(|arr| arr.len()), Some(0));

    let started = recv_task(&mut receiver).await;
    let succeeded = recv_task(&mut receiver).await;

    assert_eq!(
        started.get("status").and_then(|v| v.as_str()),
        Some("started")
    );
    assert_eq!(
        succeeded.get("status").and_then(|v| v.as_str()),
        Some("succeeded")
    );
}

#[tokio::test]
async fn bulk_set_zone_outputs_muted_applies_and_emits_task_updates() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, zone) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({"name":"Mute Zone","tx_ids":["tx_0","tx_1"]}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let zone_id = zone
        .get("id")
        .and_then(|v| v.as_str())
        .expect("zone id")
        .to_string();

    let mut receiver = state.ws_tx.subscribe();
    let (status, json) = common::post_json(
        &app,
        "/api/v1/bulk",
        serde_json::json!({
            "operation":"set_zone_outputs_muted",
            "zone_id": zone_id,
            "muted": true
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("affected").and_then(|v| v.as_u64()), Some(2));

    let cfg = state.config.read().await;
    assert_eq!(cfg.output_muted, vec![true, true]);
    assert!(cfg.output_dsp.iter().all(|dsp| dsp.muted));
    drop(cfg);

    let started = recv_task(&mut receiver).await;
    let succeeded = recv_task(&mut receiver).await;

    assert_eq!(
        started.get("task_id").and_then(|v| v.as_str()),
        Some("bulk:set_zone_outputs_muted:zone_2")
    );
    assert_eq!(
        started.get("status").and_then(|v| v.as_str()),
        Some("started")
    );
    assert_eq!(
        succeeded.get("status").and_then(|v| v.as_str()),
        Some("succeeded")
    );
}

#[tokio::test]
async fn bulk_apply_zone_template_applies_and_emits_task_updates() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, zone) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({"name":"Preset Zone","tx_ids":["tx_0","tx_1"]}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let zone_id = zone
        .get("id")
        .and_then(|v| v.as_str())
        .expect("zone id")
        .to_string();

    let (status, template) = common::post_json(
        &app,
        "/api/v1/zones/templates",
        serde_json::json!({
            "name":"Speech",
            "colour_index": 6,
            "output": {
                "gain_db": -9.5,
                "muted": true,
                "eq": {
                    "enabled": true,
                    "bands": [
                        {"freq_hz": 160.0, "gain_db": 3.0, "q": 0.9, "band_type": "Peaking"}
                    ]
                },
                "limiter": {
                    "enabled": true,
                    "threshold_db": -4.0,
                    "attack_ms": 2.0,
                    "release_ms": 90.0
                }
            }
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let template_id = template
        .get("id")
        .and_then(|v| v.as_str())
        .expect("template id")
        .to_string();

    let mut receiver = state.ws_tx.subscribe();
    let (status, json) = common::post_json(
        &app,
        "/api/v1/bulk",
        serde_json::json!({
            "operation":"apply_zone_template",
            "zone_id": zone_id,
            "template_id": template_id
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("affected").and_then(|v| v.as_u64()), Some(2));

    let cfg = state.config.read().await;
    let zone = cfg
        .zone_config
        .iter()
        .find(|zone| zone.id == "zone_2")
        .expect("zone");
    assert_eq!(zone.colour_index, 6);
    assert_eq!(cfg.output_gain_db, vec![-9.5, -9.5]);
    assert_eq!(cfg.output_muted, vec![true, true]);
    assert!(cfg.per_output_eq.iter().all(|eq| eq.enabled));
    assert!(cfg.per_output_limiter.iter().all(|lim| lim.enabled));
    assert!(cfg
        .output_dsp
        .iter()
        .all(|dsp| dsp.gain_db == -9.5 && dsp.muted && dsp.eq.enabled && dsp.limiter.enabled));
    assert_eq!(cfg.output_dsp[0].eq.bands[0].gain_db, 3.0);
    assert_eq!(cfg.output_dsp[0].limiter.threshold_db, -4.0);
    drop(cfg);

    let started = recv_task(&mut receiver).await;
    let succeeded = recv_task(&mut receiver).await;

    assert_eq!(
        started.get("task_id").and_then(|v| v.as_str()),
        Some("bulk:apply_zone_template:zone_2:zone_template_0")
    );
    assert_eq!(
        started.get("status").and_then(|v| v.as_str()),
        Some("started")
    );
    assert_eq!(
        succeeded.get("status").and_then(|v| v.as_str()),
        Some("succeeded")
    );
}

#[tokio::test]
async fn config_restore_emits_task_updates() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let mut cfg = state.config.read().await.clone();
    cfg.show_buses_in_mixer = true;
    let body = toml::to_string_pretty(&cfg).expect("config toml");

    let mut receiver = state.ws_tx.subscribe();
    let status = post_toml(&app, "/api/v1/system/config/restore", &tok, body).await;
    assert_eq!(status, StatusCode::OK);

    let started = recv_task(&mut receiver).await;
    let succeeded = recv_task(&mut receiver).await;

    assert_eq!(
        started.get("task_id").and_then(|v| v.as_str()),
        Some("config:restore")
    );
    assert_eq!(
        started.get("status").and_then(|v| v.as_str()),
        Some("started")
    );
    assert_eq!(
        succeeded.get("status").and_then(|v| v.as_str()),
        Some("succeeded")
    );
}
