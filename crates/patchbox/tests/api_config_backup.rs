mod common;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use patchbox_core::config::PatchboxConfig;
use std::net::SocketAddr;
use tower::ServiceExt;

// ── helpers ──────────────────────────────────────────────────────────────────

async fn get_backup_raw(
    app: &axum::Router,
    bearer: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/system/config/backup");
    if let Some(tok) = bearer {
        req = req.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }
    let mut req = req.body(Body::empty()).unwrap();
    let addr: SocketAddr = "127.0.0.1:9191".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    (status, headers, bytes)
}

async fn post_restore_raw(
    app: &axum::Router,
    body: &str,
    bearer: Option<&str>,
) -> (StatusCode, Vec<u8>) {
    let mut req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/system/config/restore")
        .header(header::CONTENT_TYPE, "application/toml");
    if let Some(tok) = bearer {
        req = req.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }
    let mut req = req.body(Body::from(body.to_owned())).unwrap();
    let addr: SocketAddr = "127.0.0.1:9191".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    (status, bytes)
}

async fn post_toml_raw(
    app: &axum::Router,
    uri: &str,
    body: &str,
    bearer: Option<&str>,
) -> (StatusCode, Vec<u8>) {
    let mut req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/toml");
    if let Some(tok) = bearer {
        req = req.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }
    let mut req = req.body(Body::from(body.to_owned())).unwrap();
    let addr: SocketAddr = "127.0.0.1:9191".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    (status, bytes)
}

async fn get_backups_json(
    app: &axum::Router,
    bearer: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let mut req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/system/config/backups");
    if let Some(tok) = bearer {
        req = req.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }
    let mut req = req.body(Body::empty()).unwrap();
    let addr: SocketAddr = "127.0.0.1:9191".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).expect("response should be JSON");
    (status, json)
}

// ── GET /api/v1/system/config/backup ─────────────────────────────────────────

#[tokio::test]
async fn backup_get_200_valid_toml() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, headers, bytes) = get_backup_raw(&app, Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        ct.contains("application/toml"),
        "unexpected Content-Type: {ct}"
    );

    let cd = headers
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        cd.contains("attachment"),
        "Content-Disposition should be attachment, got: {cd}"
    );
    assert!(
        cd.contains(".toml"),
        "filename should end in .toml, got: {cd}"
    );

    let text = std::str::from_utf8(&bytes).expect("body should be UTF-8");
    // Must parse as valid TOML.
    toml::from_str::<toml::Value>(text).expect("response body should be valid TOML");
}

#[tokio::test]
async fn backup_get_401_unauthenticated() {
    let app = common::test_app();
    let (status, _headers, _bytes) = get_backup_raw(&app, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ── POST /api/v1/system/config/restore ───────────────────────────────────────

#[tokio::test]
async fn restore_post_valid_toml_200() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // First download current config as a valid TOML fixture.
    let (dl_status, _headers, dl_bytes) = get_backup_raw(&app, Some(&tok)).await;
    assert_eq!(dl_status, StatusCode::OK);
    let valid_toml = std::str::from_utf8(&dl_bytes).unwrap();

    let (status, bytes) = post_restore_raw(&app, valid_toml, Some(&tok)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );

    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("response should be JSON");
    assert_eq!(json["status"], "ok");
}

#[tokio::test]
async fn restore_post_invalid_toml_400() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, bytes) = post_restore_raw(&app, "not valid toml [[[[", Some(&tok)).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
}

#[tokio::test]
async fn restore_post_401_unauthenticated() {
    let app = common::test_app();
    let (status, _bytes) = post_restore_raw(&app, "rx_channels = 2\n", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn validate_post_returns_diff_without_mutating_config() {
    let (app, state) = common::test_app_with_state();
    let tok = common::login_token(&app);

    let original_toml = std::fs::read_to_string(&state.config_path).expect("read config");
    let mut candidate: PatchboxConfig = toml::from_str(&original_toml).expect("parse config");
    candidate.dante_name = "preview-device".to_string();
    let candidate_toml = toml::to_string_pretty(&candidate).expect("serialize candidate");

    let (status, bytes) = post_toml_raw(
        &app,
        "/api/v1/system/config/validate",
        &candidate_toml,
        Some(&tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );

    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("response should be JSON");
    assert_eq!(json["valid"], true);
    assert_eq!(json["warnings"].as_array().map(|arr| arr.len()), Some(0));
    assert_eq!(json["summary"]["total_changes"], 1);
    assert!(json["summary"]["description"]
        .as_str()
        .unwrap_or("")
        .contains("dante_name"));
    assert_eq!(json["changes"][0]["path"], "dante_name");
    assert_eq!(json["changes"][0]["after"], "preview-device");

    let after_toml = std::fs::read_to_string(&state.config_path).expect("read config");
    assert_eq!(after_toml, original_toml);
}

#[tokio::test]
async fn validate_post_invalid_toml_reports_error() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, bytes) = post_toml_raw(
        &app,
        "/api/v1/system/config/validate",
        "not valid toml [[[[",
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("response should be JSON");
    assert_eq!(json["valid"], false);
    assert_eq!(json["warnings"].as_array().map(|arr| arr.len()), Some(0));
    assert_eq!(json["summary"]["total_changes"], 0);
    assert!(json["errors"]
        .as_array()
        .expect("errors array")
        .first()
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .contains("invalid config TOML"));
}

#[tokio::test]
async fn validate_post_rx_shrink_reports_warning() {
    let (app, state) = common::test_app_with_state();
    let tok = common::login_token(&app);

    let original_toml = std::fs::read_to_string(&state.config_path).expect("read config");
    let mut candidate: PatchboxConfig = toml::from_str(&original_toml).expect("parse config");
    candidate.rx_channels = candidate.rx_channels.saturating_sub(1).max(1);
    let candidate_toml = toml::to_string_pretty(&candidate).expect("serialize candidate");

    let (status, bytes) = post_toml_raw(
        &app,
        "/api/v1/system/config/validate",
        &candidate_toml,
        Some(&tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );

    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("response should be JSON");
    assert_eq!(json["valid"], true);
    let warnings = json["warnings"].as_array().expect("warnings array");
    assert!(
        warnings
            .iter()
            .any(|warning| warning["code"].as_str() == Some("rx_shrink")),
        "expected rx shrink warning, got: {json}"
    );
}

#[tokio::test]
async fn restore_post_creates_backup_metadata_and_returns_it_in_list() {
    let (app, state) = common::test_app_with_state();
    let tok = common::login_token(&app);

    let original_toml = std::fs::read_to_string(&state.config_path).expect("read config");
    let mut candidate: PatchboxConfig = toml::from_str(&original_toml).expect("parse config");
    candidate.dante_name = "restored-device".to_string();
    let candidate_toml = toml::to_string_pretty(&candidate).expect("serialize candidate");

    let (status, bytes) = post_restore_raw(&app, &candidate_toml, Some(&tok)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );

    let (list_status, json) = get_backups_json(&app, Some(&tok)).await;
    assert_eq!(list_status, StatusCode::OK);
    let backups = json.as_array().expect("backups array");
    assert_eq!(backups.len(), 1);

    let backup = &backups[0];
    assert_eq!(backup["metadata"]["has_metadata"], true);
    assert_eq!(backup["metadata"]["source"], "restore");
    assert_eq!(backup["metadata"]["requested_by"], "test");
    assert!(backup["metadata"]["note"]
        .as_str()
        .unwrap_or("")
        .contains("before config restore"));
    assert!(backup["metadata"]["summary"]
        .as_str()
        .unwrap_or("")
        .contains("dante_name"));
    assert!(backup["metadata"]["version"].as_str().is_some());
    assert!(backup["metadata"]["created_at"].as_str().is_some());

    let backup_name = backup["name"].as_str().expect("backup name");
    let metadata_path = state
        .config_path
        .parent()
        .expect("config dir")
        .join(format!("{backup_name}.meta.json"));
    let metadata_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(metadata_path).expect("read metadata"))
            .expect("parse metadata");
    assert_eq!(metadata_json["source"], "restore");
    assert_eq!(metadata_json["requested_by"], "test");
}

#[tokio::test]
async fn backup_list_keeps_legacy_backups_without_metadata() {
    let (app, state) = common::test_app_with_state();
    let tok = common::login_token(&app);

    let legacy_name = "config-bak-123.toml";
    let legacy_path = state
        .config_path
        .parent()
        .expect("config dir")
        .join(legacy_name);
    std::fs::write(
        &legacy_path,
        std::fs::read_to_string(&state.config_path).expect("read config"),
    )
    .expect("write legacy backup");

    let (status, json) = get_backups_json(&app, Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let backup = json
        .as_array()
        .expect("backups array")
        .iter()
        .find(|entry| entry["name"] == legacy_name)
        .expect("legacy backup present");
    assert_eq!(backup["metadata"]["has_metadata"], false);
    assert_eq!(backup["metadata"]["source"], "unknown");
    assert!(backup["metadata"]["version"].is_null());
    assert!(backup["metadata"]["summary"].is_null());
}
