mod common;

use axum::http::StatusCode;

// PUT /api/v1/inputs/:ch/compressor stores the block; GET /api/v1/inputs/:ch/dsp
// returns it with the updated params (round-trip).
#[tokio::test]
async fn input_compressor_round_trip() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // PUT using the DspBlock envelope format.
    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/inputs/0/compressor",
        serde_json::json!({
            "kind": "cmp",
            "enabled": true,
            "version": 1,
            "params": {
                "threshold_db": -12.0,
                "ratio": 4.0,
                "knee_db": 3.0,
                "attack_ms": 5.0,
                "release_ms": 50.0,
                "makeup_db": 3.0
            }
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // GET full DSP struct for channel 0 and verify compressor params.
    let (status, json) = common::get_json(&app, "/api/v1/inputs/0/dsp", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let cmp = json
        .get("compressor")
        .expect("InputChannelDsp must have compressor field");

    assert_eq!(
        cmp.get("enabled").and_then(|v| v.as_bool()),
        Some(true),
        "compressor.enabled"
    );

    let threshold = cmp
        .get("threshold_db")
        .and_then(|v| v.as_f64())
        .expect("threshold_db");
    assert!(
        (threshold - (-12.0)).abs() < 1e-5,
        "expected threshold_db=-12.0, got {threshold}"
    );

    let ratio = cmp
        .get("ratio")
        .and_then(|v| v.as_f64())
        .expect("ratio");
    assert!(
        (ratio - 4.0).abs() < 1e-5,
        "expected ratio=4.0, got {ratio}"
    );
}

// PUT compressor in old flat format (backward-compat) also accepted.
#[tokio::test]
async fn input_compressor_flat_format_accepted() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/inputs/0/compressor",
        serde_json::json!({
            "enabled": true,
            "threshold_db": -6.0,
            "ratio": 2.0,
            "knee_db": 6.0,
            "attack_ms": 10.0,
            "release_ms": 100.0,
            "makeup_db": 0.0
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = common::get_json(&app, "/api/v1/inputs/0/dsp", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let threshold = json
        .get("compressor")
        .and_then(|c| c.get("threshold_db"))
        .and_then(|v| v.as_f64())
        .expect("threshold_db");
    assert!(
        (threshold - (-6.0)).abs() < 1e-5,
        "expected -6.0, got {threshold}"
    );
}

// PUT compressor on out-of-range channel → 404.
#[tokio::test]
async fn input_compressor_nonexistent_channel_404() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/inputs/99/compressor",
        serde_json::json!({"enabled": false}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// GET /api/v1/inputs/:ch/dsp on nonexistent channel → 404.
#[tokio::test]
async fn input_dsp_nonexistent_channel_404() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // The 404 response has an empty body so we use send() to avoid JSON parse error.
    let (status, _resp, _bytes) = common::send(
        &app,
        axum::http::Method::GET,
        "/api/v1/inputs/99/dsp",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// After PUT compressor, the ChannelResponse.dsp.cmp block reflects the new params.
#[tokio::test]
async fn channel_dsp_value_includes_updated_compressor() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, _) = common::put_json(
        &app,
        "/api/v1/inputs/0/compressor",
        serde_json::json!({
            "kind": "cmp",
            "enabled": true,
            "version": 1,
            "params": {"threshold_db": -20.0}
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // ChannelResponse.dsp is produced by dsp_to_value() which wraps blocks under
    // their short keys ("cmp", "peq", etc.).
    let (status, json) = common::get_json(&app, "/api/v1/channels/rx_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    let threshold = json
        .get("dsp")
        .and_then(|d| d.get("cmp"))
        .and_then(|c| c.get("params"))
        .and_then(|p| p.get("threshold_db"))
        .and_then(|v| v.as_f64())
        .expect("dsp.cmp.params.threshold_db");

    assert!(
        (threshold - (-20.0)).abs() < 1e-5,
        "expected -20.0, got {threshold}"
    );
}

// No token on DSP endpoint → 401 with ErrorResponse.
#[tokio::test]
async fn dsp_unauthenticated_returns_401() {
    let app = common::test_app();

    let (status, json) = common::get_json(&app, "/api/v1/inputs/0/dsp", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        json.get("error").and_then(|v| v.as_str()).is_some(),
        "expected ErrorResponse {{error}}, got: {json}"
    );
}
