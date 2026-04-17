mod common;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
};
use http_body_util::BodyExt;
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
    assert!(ct.contains("application/toml"), "unexpected Content-Type: {ct}");

    let cd = headers
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        cd.contains("attachment"),
        "Content-Disposition should be attachment, got: {cd}"
    );
    assert!(cd.contains(".toml"), "filename should end in .toml, got: {cd}");

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
    assert_eq!(status, StatusCode::OK, "body: {}", String::from_utf8_lossy(&bytes));

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
