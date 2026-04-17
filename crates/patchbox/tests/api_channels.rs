mod common;

use axum::http::{Method, StatusCode};

#[tokio::test]
async fn channels_list_returns_fixture_channels() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, json) = common::get_json(&app, "/api/v1/channels", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let arr = json.as_array().expect("channels must be array");
    assert_eq!(arr.len(), 2);

    assert_eq!(arr[0].get("id").and_then(|v| v.as_str()), Some("rx_0"));
    assert_eq!(arr[0].get("name").and_then(|v| v.as_str()), Some("Input 1"));

    assert_eq!(arr[1].get("id").and_then(|v| v.as_str()), Some("rx_1"));
    assert_eq!(arr[1].get("name").and_then(|v| v.as_str()), Some("Input 2"));

    for item in arr {
        assert!(item.get("gain_db").is_some());
        assert!(item.get("enabled").is_some());
        assert!(item.get("dsp").is_some());
    }
}

#[tokio::test]
async fn channel_update_persists() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/channels/rx_0",
        serde_json::json!({
            "name": "Vocal 1",
            "gain_db": 999.0,
            "enabled": false,
            "colour_index": 3,
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = common::get_json(&app, "/api/v1/channels/rx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(json.get("id").and_then(|v| v.as_str()), Some("rx_0"));
    assert_eq!(json.get("name").and_then(|v| v.as_str()), Some("Vocal 1"));
    assert_eq!(json.get("enabled").and_then(|v| v.as_bool()), Some(false));
    assert_eq!(json.get("colour_index").and_then(|v| v.as_u64()), Some(3));

    // gain_db is clamped to [-60, 24]
    let gain = json
        .get("gain_db")
        .and_then(|v| v.as_f64())
        .expect("gain_db must be number");
    assert!((gain - 24.0).abs() < 1e-6, "expected 24.0, got {gain}");
}

#[tokio::test]
async fn channel_out_of_range_returns_404() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::GET,
        "/api/v1/channels/rx_999",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn channel_invalid_id_returns_400() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _resp, _bytes) =
        common::send(&app, Method::GET, "/api/v1/channels/nope", None, Some(&tok)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
