mod common;

use axum::http::{Method, StatusCode};

#[tokio::test]
async fn outputs_list_returns_fixture_outputs() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, json) = common::get_json(&app, "/api/v1/outputs", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let arr = json.as_array().expect("outputs must be array");
    assert_eq!(arr.len(), 2);

    assert_eq!(arr[0].get("id").and_then(|v| v.as_str()), Some("tx_0"));
    assert_eq!(
        arr[0].get("name").and_then(|v| v.as_str()),
        Some("Output 1")
    );

    assert_eq!(arr[1].get("id").and_then(|v| v.as_str()), Some("tx_1"));
    assert_eq!(
        arr[1].get("name").and_then(|v| v.as_str()),
        Some("Output 2")
    );

    for item in arr {
        assert!(item.get("volume_db").is_some());
        assert!(item.get("muted").is_some());
        assert!(item.get("dsp").is_some());
    }
}

#[tokio::test]
async fn output_update_persists() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/outputs/tx_0",
        serde_json::json!({
            "name": "Main",
            "volume_db": -100.0,
            "muted": true,
        }),
        Some(&tok),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = common::get_json(&app, "/api/v1/outputs/tx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(json.get("id").and_then(|v| v.as_str()), Some("tx_0"));
    assert_eq!(json.get("name").and_then(|v| v.as_str()), Some("Main"));
    assert_eq!(json.get("muted").and_then(|v| v.as_bool()), Some(true));

    // volume_db is clamped to [-60, 24]
    let vol = json
        .get("volume_db")
        .and_then(|v| v.as_f64())
        .expect("volume_db must be number");
    assert!((vol - (-60.0)).abs() < 1e-6, "expected -60.0, got {vol}");
}

#[tokio::test]
async fn output_out_of_range_returns_404() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::GET,
        "/api/v1/outputs/tx_999",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn output_invalid_id_returns_400() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _resp, _bytes) =
        common::send(&app, Method::GET, "/api/v1/outputs/nope", None, Some(&tok)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
