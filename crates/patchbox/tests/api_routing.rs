mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn matrix_and_routes_roundtrip() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Starts empty
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(routes.as_array().map(|v| v.len()), Some(0));

    // PUT /matrix enables a crosspoint and clamps gain_db to [-40, 12]
    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/matrix",
        serde_json::json!({"tx":0,"rx":1,"enabled":true,"gain_db":13.0}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, matrix) = common::get_json(&app, "/api/v1/matrix", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let enabled = matrix
        .get("enabled")
        .and_then(|v| v.as_array())
        .expect("enabled must be 2d array");
    assert_eq!(
        enabled
            .get(0)
            .and_then(|v| v.as_array())
            .and_then(|row| row.get(1))
            .and_then(|v| v.as_bool()),
        Some(true)
    );

    let gain = matrix
        .get("gain_db")
        .and_then(|v| v.as_array())
        .and_then(|v| v.get(0))
        .and_then(|v| v.as_array())
        .and_then(|row| row.get(1))
        .and_then(|v| v.as_f64())
        .expect("gain_db[0][1] must be number");
    assert!((gain - 12.0).abs() < 1e-6, "expected 12.0, got {gain}");

    // /routes reflects active crosspoints
    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = routes.as_array().expect("routes must be array");
    assert!(
        arr.iter()
            .any(|r| r.get("id").and_then(|v| v.as_str()) == Some("rx_1|tx_0")),
        "expected route rx_1|tx_0, got: {routes}"
    );

    // Delete the route (pipe must be URL-encoded)
    let status = common::delete(&app, "/api/v1/routes/rx_1%7Ctx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(routes.as_array().map(|v| v.len()), Some(0));

    // POST /routes turns on a crosspoint
    let (status, created) = common::post_json(
        &app,
        "/api/v1/routes",
        serde_json::json!({"rx_id":"rx_0","tx_id":"tx_1"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        created.get("id").and_then(|v| v.as_str()),
        Some("rx_0|tx_1")
    );

    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = routes.as_array().expect("routes must be array");
    assert!(arr
        .iter()
        .any(|r| r.get("id").and_then(|v| v.as_str()) == Some("rx_0|tx_1")));

    let status = common::delete(&app, "/api/v1/routes/rx_0%7Ctx_1", Some(&tok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, routes) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(routes.as_array().map(|v| v.len()), Some(0));
}
