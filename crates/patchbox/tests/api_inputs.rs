mod common;

use axum::http::StatusCode;

// GET /api/v1/channels returns fixture inputs.
#[tokio::test]
async fn inputs_list_returns_fixture_channels() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, json) = common::get_json(&app, "/api/v1/channels", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let arr = json.as_array().expect("inputs must be array");
    assert_eq!(arr.len(), 2);

    assert_eq!(arr[0].get("id").and_then(|v| v.as_str()), Some("rx_0"));
    assert_eq!(arr[0].get("name").and_then(|v| v.as_str()), Some("Input 1"));
    assert_eq!(arr[1].get("id").and_then(|v| v.as_str()), Some("rx_1"));
    assert_eq!(arr[1].get("name").and_then(|v| v.as_str()), Some("Input 2"));

    for item in arr {
        assert!(item.get("gain_db").is_some(), "missing gain_db");
        assert!(item.get("enabled").is_some(), "missing enabled");
        assert!(item.get("dsp").is_some(), "missing dsp");
    }
}

// PUT rename + gain, GET verify round-trip.
#[tokio::test]
async fn input_rename_and_gain_persist() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/channels/rx_0",
        serde_json::json!({"name": "Mic 1", "gain_db": 6.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = common::get_json(&app, "/api/v1/channels/rx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("name").and_then(|v| v.as_str()), Some("Mic 1"));
    let gain = json
        .get("gain_db")
        .and_then(|v| v.as_f64())
        .expect("gain_db");
    assert!((gain - 6.0).abs() < 1e-5, "expected 6.0, got {gain}");
}

// gain_db is clamped to [-60, 24].
#[tokio::test]
async fn input_gain_clamped_to_max() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/channels/rx_0",
        serde_json::json!({"gain_db": 9999.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = common::get_json(&app, "/api/v1/channels/rx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let gain = json
        .get("gain_db")
        .and_then(|v| v.as_f64())
        .expect("gain_db");
    assert!(
        (gain - 24.0).abs() < 1e-5,
        "expected clamped to 24.0, got {gain}"
    );
}

// PUT nonexistent input ID → 404.
#[tokio::test]
async fn input_put_nonexistent_returns_404() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/channels/rx_99",
        serde_json::json!({"name": "Ghost"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// GET nonexistent input ID → 404.
#[tokio::test]
async fn input_get_nonexistent_returns_404() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _resp, _bytes) = common::send(
        &app,
        axum::http::Method::GET,
        "/api/v1/channels/rx_99",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// Invalid ID format → 400.
#[tokio::test]
async fn input_bad_id_returns_400() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Returns plain text "invalid channel id", not JSON.
    let (status, _resp, _bytes) = common::send(
        &app,
        axum::http::Method::GET,
        "/api/v1/channels/not_an_id",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// No token → 401 with ErrorResponse shape.
#[tokio::test]
async fn inputs_unauthenticated_returns_401() {
    let app = common::test_app();

    let (status, json) = common::get_json(&app, "/api/v1/channels", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        json.get("error").and_then(|v| v.as_str()).is_some(),
        "expected ErrorResponse {{error}}, got: {json}"
    );
}
