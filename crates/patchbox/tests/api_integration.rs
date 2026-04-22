// S7 s7-test-api-integration — API integration tests.
//
// Tests the full API surface by driving the router directly (tower ServiceExt)
// which exercises all middleware, routing, and state changes together.
//
// Run: `cargo test -p patchbox --test api_integration`.

mod common;

use axum::http::{Method, StatusCode};

#[tokio::test]
async fn health_endpoint_works_without_auth() {
    let app = common::test_app();

    let (status, json) = common::get_json(&app, "/api/v1/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("status").and_then(|v| v.as_str()), Some("unhealthy"));
}

#[tokio::test]
async fn login_and_authenticated_requests() {
    let app = common::test_app();

    // Unauthenticated request to protected endpoint fails
    let (status, _) = common::get_json(&app, "/api/v1/channels", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Valid token allows access
    let tok = common::login_token(&app);
    let (status, json) = common::get_json(&app, "/api/v1/channels", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    // Returns an array of channels
    assert!(json.as_array().is_some(), "channels should return an array");
    let channels = json.as_array().expect("channels array");
    assert!(!channels.is_empty(), "should have at least one channel");
}

#[tokio::test]
async fn full_routing_set_get_roundtrip() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Initially no routes
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(routes.as_array().map(|v| v.len()), Some(0));

    // Enable crosspoint via PUT matrix
    let (status, _) = common::put_json(
        &app,
        "/api/v1/matrix",
        serde_json::json!({"tx": 0, "rx": 0, "enabled": true, "gain_db": -6.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify via GET matrix
    let (status, matrix) = common::get_json(&app, "/api/v1/matrix", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let enabled = matrix
        .get("enabled")
        .and_then(|v| v.as_array())
        .and_then(|v| v.get(0))
        .and_then(|v| v.as_array())
        .and_then(|v| v.get(0))
        .and_then(|v| v.as_bool())
        .expect("matrix[0][0] enabled");
    assert!(enabled, "crosspoint should be enabled");

    let gain = matrix
        .get("gain_db")
        .and_then(|v| v.as_array())
        .and_then(|v| v.get(0))
        .and_then(|v| v.as_array())
        .and_then(|v| v.get(0))
        .and_then(|v| v.as_f64())
        .expect("matrix[0][0] gain");
    assert!((gain - (-6.0)).abs() < 0.1, "gain should be -6 dB");

    // Route appears in /routes
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = routes.as_array().expect("routes array");
    assert!(arr.iter().any(|r| r.get("id").and_then(|v| v.as_str()) == Some("rx_0|tx_0")));

    // Disable via DELETE
    let status = common::delete(&app, "/api/v1/routes/rx_0%7Ctx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify disabled
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(routes.as_array().map(|v| v.len()), Some(0));
}

#[tokio::test]
async fn dsp_chain_roundtrip() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Set compressor params via PUT
    let (status, _) = common::put_json(
        &app,
        "/api/v1/inputs/0/compressor",
        serde_json::json!({
            "enabled": true,
            "threshold_db": -18.0,
            "ratio": 4.0,
            "knee_db": 6.0,
            "attack_ms": 10.0,
            "release_ms": 100.0,
            "makeup_db": 3.0
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Get full DSP struct and verify
    let (status, json) = common::get_json(&app, "/api/v1/inputs/0/dsp", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let cmp = json.get("compressor").expect("compressor field");
    assert_eq!(cmp.get("enabled").and_then(|v| v.as_bool()), Some(true));
    assert!((cmp.get("threshold_db").and_then(|v| v.as_f64()).unwrap() - (-18.0)).abs() < 0.1);
    assert!((cmp.get("ratio").and_then(|v| v.as_f64()).unwrap() - 4.0).abs() < 0.1);
    assert!((cmp.get("makeup_db").and_then(|v| v.as_f64()).unwrap() - 3.0).abs() < 0.1);

    // Update gate
    let (status, _) = common::put_json(
        &app,
        "/api/v1/inputs/0/gate",
        serde_json::json!({
            "enabled": true,
            "threshold_db": -40.0,
            "ratio": 10.0,
            "attack_ms": 1.0,
            "hold_ms": 50.0,
            "release_ms": 200.0,
            "range_db": -60.0
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify gate via channel endpoint
    let (status, json) = common::get_json(&app, "/api/v1/channels/rx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    // DSP uses short keys: "gte" for gate, "cmp" for compressor, etc.
    let gate = json.get("dsp").and_then(|d| d.get("gte")).expect("gate (gte) in dsp");
    let params = gate.get("params").expect("gate params");
    assert_eq!(gate.get("enabled").and_then(|v| v.as_bool()), Some(true));
    assert!((params.get("threshold_db").and_then(|v| v.as_f64()).unwrap() - (-40.0)).abs() < 0.1);
}

#[tokio::test]
async fn scene_save_recall() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Create a route first
    let (status, _) = common::put_json(
        &app,
        "/api/v1/matrix",
        serde_json::json!({"tx": 0, "rx": 0, "enabled": true, "gain_db": 0.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Save scene
    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes",
        Some(serde_json::json!({"name": "test_scene", "description": "Integration test scene"})),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify scene exists
    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let scenes = json.get("scenes").and_then(|v| v.as_array()).expect("scenes array");
    assert_eq!(scenes.len(), 1);
    assert_eq!(scenes[0].get("name").and_then(|v| v.as_str()), Some("test_scene"));

    // Clear the route
    let status = common::delete(&app, "/api/v1/routes/rx_0%7Ctx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify cleared
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(routes.as_array().map(|v| v.len()), Some(0));

    // Recall scene
    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/test_scene/load",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify route restored
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = routes.as_array().expect("routes array");
    assert!(arr.iter().any(|r| r.get("id").and_then(|v| v.as_str()) == Some("rx_0|tx_0")));

    // Active scene should be set
    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("active").and_then(|v| v.as_str()), Some("test_scene"));
}

#[tokio::test]
async fn config_endpoint_returns_full_state() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, json) = common::get_json(&app, "/api/v1/config", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    // Config should have all the major sections
    assert!(json.get("rx_channels").is_some());
    assert!(json.get("tx_channels").is_some());
    assert!(json.get("matrix").is_some());
    assert!(json.get("input_dsp").is_some());
    assert!(json.get("output_dsp").is_some());
    assert!(json.get("zones").is_some());
    assert!(json.get("sources").is_some());
}

#[tokio::test]
async fn multiple_crosspoints_independent() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Enable two crosspoints
    let (status, _) = common::put_json(
        &app,
        "/api/v1/matrix",
        serde_json::json!({"tx": 0, "rx": 0, "enabled": true, "gain_db": 0.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = common::put_json(
        &app,
        "/api/v1/matrix",
        serde_json::json!({"tx": 1, "rx": 1, "enabled": true, "gain_db": -12.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify both
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = routes.as_array().expect("routes array");
    assert_eq!(arr.len(), 2);

    // Disable only one
    let status = common::delete(&app, "/api/v1/routes/rx_0%7Ctx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify only one remains
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = routes.as_array().expect("routes array");
    assert_eq!(arr.len(), 1);
    assert!(arr.iter().any(|r| r.get("id").and_then(|v| v.as_str()) == Some("rx_1|tx_1")));
}
