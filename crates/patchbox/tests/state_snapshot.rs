// S7 s7-test-state-snapshot — golden JSON snapshot of GET /state endpoints.
//
// Uses `insta` crate: first run writes .snap, subsequent runs assert.
// Run: `INSTA_UPDATE=always cargo test -p patchbox --test state_snapshot` to generate,
// then `cargo test -p patchbox --test state_snapshot` to verify.

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use patchbox::api;
use patchbox::state::AppState;
use patchbox_core::config::PatchboxConfig;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower::ServiceExt;

fn make_request(uri: &str) -> Request<Body> {
    let mut request = Request::builder()
        .uri(uri)
        .method("GET")
        .body(Body::empty())
        .unwrap();

    // Add ConnectInfo for rate limiting middleware
    let addr: SocketAddr = "127.0.0.1:8000".parse().unwrap();
    request.extensions_mut().insert(ConnectInfo(addr));

    request
}

fn redact_health_json(mut json: serde_json::Value) -> serde_json::Value {
    // Redact dynamic fields: uptime_secs, timestamps, client counts
    if let Some(obj) = json.as_object_mut() {
        obj.insert("uptime_secs".to_string(), serde_json::json!(0));

        // Redact config.last_modified
        if let Some(config) = obj.get_mut("config") {
            if let Some(config_obj) = config.as_object_mut() {
                config_obj.insert("last_modified".to_string(), serde_json::json!(null));
            }
        }

        // Redact clients_connected
        obj.insert("clients_connected".to_string(), serde_json::json!(0));
    }
    json
}

#[tokio::test]
async fn snapshot_health() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = make_request("/api/v1/health");
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8_lossy(&body);

    assert_eq!(status, StatusCode::OK, "Response body: {}", body_str);

    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    let redacted = redact_health_json(json);

    insta::assert_snapshot!("health", redacted.to_string());
}

#[tokio::test]
async fn snapshot_config() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = make_request("/api/v1/config");
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8_lossy(&body);

    assert_eq!(status, StatusCode::OK, "Response body: {}", body_str);

    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    insta::assert_snapshot!("config", json.to_string());
}

// NOTE: The following endpoints require JWT auth tokens and are not tested here:
// - GET /api/v1/channels — requires valid JWT
// - GET /api/v1/outputs — requires valid JWT
// - GET /api/v1/zones — requires valid JWT
// - GET /api/v1/buses — requires valid JWT
//
// TODO: Add auth harness to generate and pass JWT tokens, then snapshot these routes.
// For now, these two public endpoints (health, config) provide coverage of schema changes
// in the core configuration structures and system status reporting.
