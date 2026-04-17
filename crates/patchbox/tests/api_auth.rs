mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn login_bad_creds_returns_401_error_response() {
    let app = common::test_app();

    let (status, json) = common::post_json(
        &app,
        "/api/v1/login",
        serde_json::json!({"username":"no-such-user","password":"bad"}),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        json.get("error").and_then(|v| v.as_str()).is_some(),
        "expected ErrorResponse {{ error, .. }}, got: {json}"
    );
}

#[tokio::test]
async fn protected_endpoint_without_token_returns_401() {
    let app = common::test_app();

    // Any protected endpoint is fine; /channels is a simple one.
    let (status, json) = common::get_json(&app, "/api/v1/channels", None).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        json.get("error").and_then(|v| v.as_str()).is_some(),
        "expected ErrorResponse {{ error, .. }}, got: {json}"
    );
}

#[tokio::test]
#[ignore]
async fn login_good_creds_returns_token() {
    // Requires PAM + a real user/password in the environment running tests.
    // Set PATCHBOX_TEST_USERNAME/PATCHBOX_TEST_PASSWORD to enable.
    let username = std::env::var("PATCHBOX_TEST_USERNAME")
        .expect("PATCHBOX_TEST_USERNAME not set (test ignored by default)");
    let password = std::env::var("PATCHBOX_TEST_PASSWORD")
        .expect("PATCHBOX_TEST_PASSWORD not set (test ignored by default)");

    let app = common::test_app();

    let (status, json) = common::post_json(
        &app,
        "/api/v1/login",
        serde_json::json!({"username": username, "password": password}),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let token = json
        .get("token")
        .and_then(|v| v.as_str())
        .expect("token must be present");
    assert!(!token.is_empty());
}

#[tokio::test]
#[ignore]
async fn bad_payload_missing_field_returns_standard_error_response() {
    // TODO: Axum's Json extractor rejection currently returns a framework-shaped 4xx,
    // not crate::api::ErrorResponse. If/when we standardize rejections, enable.
    let app = common::test_app();

    let (status, _resp, bytes) = common::send(
        &app,
        axum::http::Method::POST,
        "/api/v1/login",
        Some(serde_json::json!({"username":"x"})),
        None,
    )
    .await;

    assert!(status.is_client_error());

    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .expect("expected standardized ErrorResponse JSON for bad payload");
    assert!(json.get("error").is_some());
}
