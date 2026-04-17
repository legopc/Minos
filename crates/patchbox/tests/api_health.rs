mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn health_returns_expected_shape() {
    let app = common::test_app();

    let (status, json) = common::get_json(&app, "/api/v1/health", None).await;
    assert_eq!(status, StatusCode::OK);

    assert!(json.get("status").and_then(|v| v.as_str()).is_some());
    assert!(json.get("uptime_secs").and_then(|v| v.as_u64()).is_some());
    assert!(json.get("version").and_then(|v| v.as_str()).is_some());

    for k in ["dante", "ptp", "audio", "config", "dsp", "storage"] {
        assert!(json.get(k).is_some(), "missing {k}");
    }
    assert!(json.get("zones").and_then(|v| v.as_array()).is_some());
}

#[tokio::test]
async fn openapi_json_contains_paths() {
    let app = common::test_app();

    let (status, json) = common::get_json(&app, "/api/v1/openapi.json", None).await;
    assert_eq!(status, StatusCode::OK);

    let openapi = json
        .get("openapi")
        .and_then(|v| v.as_str())
        .expect("openapi field must be a string");
    assert!(
        openapi.starts_with("3."),
        "expected openapi 3.x, got {openapi}"
    );

    let paths = json
        .get("paths")
        .and_then(|v| v.as_object())
        .expect("paths must be an object");
    assert!(!paths.is_empty(), "paths map must be non-empty");
}
