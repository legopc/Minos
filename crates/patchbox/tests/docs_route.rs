// Integration test — embedded mdbook docs served at /docs/
//
// Verifies that GET /docs/ returns 200 with text/html content-type.
// Run: `cargo test -p patchbox --test docs_route`.

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
async fn docs_index_returns_html() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/nonexistent/test-docs.toml"));
    let router = api::router(state);

    let response = router.oneshot(make_request("/docs/")).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "/docs/ should return 200"
    );

    let ct = response
        .headers()
        .get("content-type")
        .expect("content-type header must be present")
        .to_str()
        .unwrap();
    assert!(
        ct.contains("text/html"),
        "content-type should be text/html, got: {ct}"
    );
}

#[tokio::test]
async fn docs_bare_returns_html() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/nonexistent/test-docs2.toml"));
    let router = api::router(state);

    let response = router.oneshot(make_request("/docs")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK, "/docs should return 200");
}

#[tokio::test]
async fn docs_missing_path_returns_404() {
    let config = PatchboxConfig::default();
    let state = AppState::new(config, PathBuf::from("/nonexistent/test-docs3.toml"));
    let router = api::router(state);

    let response = router
        .oneshot(make_request("/docs/nonexistent-page-xyz.html"))
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "missing doc path should return 404"
    );
}
