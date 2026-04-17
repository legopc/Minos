// S7 s7-test-state-snapshot — golden JSON snapshot of GET /state endpoints.
//
// Uses `insta` crate: first run writes .snap, subsequent runs assert.
// Run: `INSTA_UPDATE=always cargo test -p patchbox --test state_snapshot` to generate,
// then `cargo test -p patchbox --test state_snapshot` to verify.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use patchbox::api;
use patchbox::state::AppState;
use patchbox_core::config::PatchboxConfig;
use std::path::PathBuf;
use tower::ServiceExt;

#[tokio::test]
async fn snapshot_health() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = Request::builder()
        .uri("/api/v1/health")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    insta::assert_json_snapshot!("health", json);
}

#[tokio::test]
async fn snapshot_channels() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = Request::builder()
        .uri("/api/v1/channels")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    insta::assert_json_snapshot!("channels", json);
}

#[tokio::test]
async fn snapshot_outputs() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = Request::builder()
        .uri("/api/v1/outputs")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    insta::assert_json_snapshot!("outputs", json);
}

#[tokio::test]
async fn snapshot_zones() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = Request::builder()
        .uri("/api/v1/zones")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    insta::assert_json_snapshot!("zones", json);
}

#[tokio::test]
async fn snapshot_buses() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = Request::builder()
        .uri("/api/v1/buses")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    insta::assert_json_snapshot!("buses", json);
}

#[tokio::test]
async fn snapshot_config() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/tmp/test.toml"));
    let router = api::router(state);

    let request = Request::builder()
        .uri("/api/v1/config")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body).expect("response should be valid JSON");

    insta::assert_json_snapshot!("config", json);
}

