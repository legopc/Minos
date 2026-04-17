//! OpenAPI spec integration tests.

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
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
    let addr: SocketAddr = "127.0.0.1:9191".parse().unwrap();
    request.extensions_mut().insert(ConnectInfo(addr));
    request
}

#[tokio::test]
async fn openapi_json_returns_200() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/nonexistent/openapi-test.toml"));
    let router = api::router(state);

    let response = router
        .oneshot(make_request("/api/openapi.json"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn openapi_json_is_valid_json() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/nonexistent/openapi-test2.toml"));
    let router = api::router(state);

    let response = router
        .oneshot(make_request("/api/openapi.json"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let ct = response
        .headers()
        .get("content-type")
        .expect("content-type header must be present")
        .to_str()
        .unwrap();
    assert!(
        ct.contains("application/json"),
        "expected application/json, got: {ct}"
    );
}

#[tokio::test]
async fn openapi_docs_returns_html() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/nonexistent/openapi-test3.toml"));
    let router = api::router(state);

    let response = router.oneshot(make_request("/api/docs")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let ct = response
        .headers()
        .get("content-type")
        .expect("content-type header must be present")
        .to_str()
        .unwrap();
    assert!(ct.contains("text/html"), "expected text/html, got: {ct}");
}
