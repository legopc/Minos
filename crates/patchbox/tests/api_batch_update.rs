mod common;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use std::net::SocketAddr;
use tower::ServiceExt;

async fn post_batch(
    app: &axum::Router,
    tok: &str,
    ops: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let mut req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/batch-update")
        .header(header::AUTHORIZATION, format!("Bearer {tok}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_string(&ops).unwrap()))
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo("127.0.0.1:9191".parse::<SocketAddr>().unwrap()));
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
    (status, json)
}

#[tokio::test]
async fn batch_set_route() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, body) = post_batch(
        &app,
        &tok,
        serde_json::json!([
            {"op": "set_route", "tx": 0, "rx": 0, "enabled": true},
            {"op": "set_output_gain", "ch": 0, "db": -6.0},
        ]),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "batch should succeed: {body}");
    assert_eq!(body["applied"].as_u64().unwrap(), 2);
    assert!(body["errors"].as_array().unwrap().is_empty());

    let cfg = state.config.read().await;
    assert!(cfg.matrix[0][0], "route should be set");
    assert!(
        (cfg.output_gain_db[0] - (-6.0)).abs() < 0.01,
        "gain should be -6dB"
    );
}

#[tokio::test]
async fn batch_out_of_range_reports_error() {
    let (app, _state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, body) = post_batch(
        &app,
        &tok,
        serde_json::json!([
            {"op": "set_route", "tx": 999, "rx": 0, "enabled": true},
        ]),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["applied"].as_u64().unwrap(), 0);
    assert!(
        !body["errors"].as_array().unwrap().is_empty(),
        "should report error"
    );
}

#[tokio::test]
async fn batch_mixed_ops() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, body) = post_batch(
        &app,
        &tok,
        serde_json::json!([
            {"op": "set_route", "tx": 0, "rx": 1, "enabled": true},
            {"op": "set_input_gain", "ch": 1, "db": 3.0},
            {"op": "set_crosspoint_gain", "tx": 0, "rx": 1, "db": -3.0},
            {"op": "set_route", "tx": 999, "rx": 0, "enabled": true},
        ]),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["applied"].as_u64().unwrap(), 3);
    assert_eq!(body["errors"].as_array().unwrap().len(), 1);

    let cfg = state.config.read().await;
    assert!(cfg.matrix[0][1]);
    assert!((cfg.input_gain_db[1] - 3.0).abs() < 0.01);
    assert!((cfg.matrix_gain_db[0][1] - (-3.0)).abs() < 0.01);
}

#[tokio::test]
async fn batch_unauthenticated_returns_401() {
    let (app, _state) = common::test_app_with_state();

    let mut req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/batch-update")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("[]"))
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo("127.0.0.1:9191".parse::<SocketAddr>().unwrap()));
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
