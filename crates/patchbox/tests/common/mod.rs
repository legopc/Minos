use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
    response::Response,
    Router,
};
use http_body_util::BodyExt;
use patchbox::{api, jwt, state::AppState};
use patchbox_core::config::{InternalBusConfig, PatchboxConfig};
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::RwLock;
use tower::ServiceExt;

const TEST_JWT_SECRET: [u8; 32] = [7u8; 32];

pub fn test_app() -> Router {
    test_app_with_state().0
}

pub fn test_app_with_state() -> (Router, AppState) {
    let config = fixture_config();
    let config_toml = toml::to_string_pretty(&config).expect("serialize config");

    let scratch = scratch_dir();
    std::fs::create_dir_all(&scratch).expect("create scratch dir");

    let dir = tempfile::Builder::new()
        .prefix("patchbox-test-")
        .tempdir_in(&scratch)
        .expect("create test tempdir");

    let config_path = dir.path().join("config.toml");
    let mut state = AppState::new(config, config_path);
    std::fs::write(&state.config_path, config_toml).expect("write config");

    // Make JWT deterministic and avoid depending on /etc/patchbox/jwt.key.
    state.jwt_secret = Arc::new(RwLock::new(TEST_JWT_SECRET.to_vec()));
    state.exit_on_restart = false;

    // Keep tempdir alive for the router lifetime.
    // Router is 'static; leaking is acceptable in tests.
    std::mem::forget(dir);

    let app = api::router(state.clone());
    (app, state)
}

/// Deterministic JWT for protected endpoint tests.
pub fn login_token(_app: &Router) -> String {
    let claims = jwt::Claims::new("test", "admin", None);
    jwt::generate(&claims, &TEST_JWT_SECRET).expect("generate test jwt")
}

pub fn viewer_token() -> String {
    let claims = jwt::Claims::new("viewer-user", "viewer", None);
    jwt::generate(&claims, &TEST_JWT_SECRET).expect("generate viewer jwt")
}

pub fn operator_token() -> String {
    let claims = jwt::Claims::new("operator-user", "operator", None);
    jwt::generate(&claims, &TEST_JWT_SECRET).expect("generate operator jwt")
}

pub fn admin_token() -> String {
    let claims = jwt::Claims::new("admin-user", "admin", None);
    jwt::generate(&claims, &TEST_JWT_SECRET).expect("generate admin jwt")
}

pub fn no_role_token() -> String {
    let claims = jwt::Claims::new("old-user", "", None);
    jwt::generate(&claims, &TEST_JWT_SECRET).expect("generate no-role jwt")
}

fn scratch_dir() -> PathBuf {
    // Avoid /tmp (policy) + keep artifacts out of repo root.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("test-runtime")
}

fn fixture_config() -> PatchboxConfig {
    let mut cfg = PatchboxConfig::default();

    // Minimal but realistic fixture: 2 inputs, 2 outputs, 1 bus.
    cfg.rx_channels = 2;
    cfg.tx_channels = 2;
    cfg.sources = vec!["Input 1".to_string(), "Input 2".to_string()];
    cfg.zones = vec!["Output 1".to_string(), "Output 2".to_string()];

    cfg.internal_buses = vec![InternalBusConfig {
        id: "bus_0".to_string(),
        name: "Bus 1".to_string(),
        routing: vec![false; cfg.rx_channels],
        routing_gain: vec![0.0; cfg.rx_channels],
        dsp: patchbox_core::config::InputChannelDsp::default(),
        muted: false,
    }];

    cfg.normalize();
    cfg
}

pub async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    body_json: Option<serde_json::Value>,
    bearer: Option<&str>,
) -> (StatusCode, Response, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);

    if let Some(tok) = bearer {
        req = req.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }

    let body = if let Some(v) = body_json {
        let bytes = serde_json::to_vec(&v).expect("serialize json");
        req = req.header(header::CONTENT_TYPE, "application/json");
        Body::from(bytes)
    } else {
        Body::empty()
    };

    let mut req = req.body(body).unwrap();

    // Rate limiting middleware requires ConnectInfo.
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

    // Re-create a Response for callers that need headers.
    // (axum Response doesn't support cloning the body)
    let resp = Response::builder()
        .status(status)
        .body(Body::from(bytes.clone()))
        .unwrap();

    (status, resp, bytes)
}

pub async fn get_json(
    app: &Router,
    uri: &str,
    bearer: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let (status, _resp, bytes) = send(app, Method::GET, uri, None, bearer).await;
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("valid json");
    (status, json)
}

pub async fn put_json(
    app: &Router,
    uri: &str,
    body: serde_json::Value,
    bearer: Option<&str>,
) -> (StatusCode, Vec<u8>) {
    let (status, _resp, bytes) = send(app, Method::PUT, uri, Some(body), bearer).await;
    (status, bytes)
}

pub async fn post_json(
    app: &Router,
    uri: &str,
    body: serde_json::Value,
    bearer: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let (status, _resp, bytes) = send(app, Method::POST, uri, Some(body), bearer).await;
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

pub async fn delete(app: &Router, uri: &str, bearer: Option<&str>) -> StatusCode {
    let (status, _resp, _bytes) = send(app, Method::DELETE, uri, None, bearer).await;
    status
}
