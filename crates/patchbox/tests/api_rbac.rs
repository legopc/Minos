mod common;

use axum::http::StatusCode;

// viewer → 403 on writes
#[tokio::test]
async fn viewer_cannot_write_input() {
    let app = common::test_app();
    let tok = common::viewer_token();
    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/inputs/0/gain",
        serde_json::json!({"gain_db": 0.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("valid json");
    assert_eq!(json["error"], "insufficient_role");
    assert_eq!(json["required"], "operator");
    assert_eq!(json["actual"], "viewer");
}

// operator → 204 on input write
#[tokio::test]
async fn operator_can_write_input() {
    let app = common::test_app();
    let tok = common::operator_token();
    let (status, _) = common::put_json(
        &app,
        "/api/v1/inputs/0/gain",
        serde_json::json!({"gain_db": 0.0}),
        Some(&tok),
    )
    .await;
    assert!(status.is_success(), "expected 2xx, got {status}");
}

// admin → 200 on system write
#[tokio::test]
async fn admin_can_write_system() {
    let app = common::test_app();
    let tok = common::admin_token();
    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/system/monitor",
        serde_json::json!({"device": null, "volume_db": 0.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
}

// operator → 403 on system write
#[tokio::test]
async fn operator_cannot_write_system() {
    let app = common::test_app();
    let tok = common::operator_token();
    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/system/monitor",
        serde_json::json!({"device": null, "volume_db": 0.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("valid json");
    assert_eq!(json["error"], "insufficient_role");
    assert_eq!(json["required"], "admin");
    assert_eq!(json["actual"], "operator");
}

// missing role claim (empty string) → treated as viewer → 403 on writes
#[tokio::test]
async fn no_role_claim_treated_as_viewer() {
    let app = common::test_app();
    let tok = common::no_role_token();
    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/inputs/0/gain",
        serde_json::json!({"gain_db": 0.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("valid json");
    assert_eq!(json["actual"], "viewer");
}

// viewer → 200 on GET endpoints
#[tokio::test]
async fn viewer_can_read() {
    let app = common::test_app();
    let tok = common::viewer_token();
    let (status, _) = common::get_json(&app, "/api/v1/channels", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
}

// no token → 401 (not 403)
#[tokio::test]
async fn no_token_returns_401() {
    let app = common::test_app();
    let (status, json) = common::get_json(&app, "/api/v1/channels", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(json.get("error").is_some());
}
