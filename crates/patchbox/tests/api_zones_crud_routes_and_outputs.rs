mod common;

use axum::http::StatusCode;

fn linear(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

#[tokio::test]
async fn zone_membership_affects_outputs_and_route_bulk_delete_supports_zone_id() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Create a grouped zone containing both outputs.
    let (status, created) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({
            "name": "Main",
            "colour_index": 2,
            "tx_ids": ["tx_0", "tx_1"]
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let zone_id = created
        .get("id")
        .and_then(|v| v.as_str())
        .expect("created zone must have id")
        .to_string();

    // Outputs should reflect their zone membership.
    let (status, json) = common::get_json(&app, "/api/v1/outputs", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = json.as_array().expect("outputs list must be array");
    assert_eq!(arr.len(), 2);
    for out in arr {
        assert_eq!(out.get("name").and_then(|v| v.as_str()), Some("Main"));
        assert_eq!(
            out.get("zone_id").and_then(|v| v.as_str()),
            Some(zone_id.as_str())
        );
        assert_eq!(
            out.get("zone_colour_index").and_then(|v| v.as_u64()),
            Some(2)
        );
    }

    // Add routes to each output.
    let (status, _) = common::post_json(
        &app,
        "/api/v1/routes",
        serde_json::json!({"rx_id":"rx_0","tx_id":"tx_0"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = common::post_json(
        &app,
        "/api/v1/routes",
        serde_json::json!({"rx_id":"rx_1","tx_id":"tx_1"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Bulk delete by zone_id should clear all dante routes feeding that zone.
    let status = common::delete(
        &app,
        &format!("/api/v1/routes?zone_id={}", zone_id),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = common::get_json(&app, "/api/v1/routes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let routes = json.as_array().expect("routes must be array");
    assert!(
        routes.is_empty(),
        "expected all routes cleared, got {routes:?}"
    );
}

#[tokio::test]
async fn zone_metering_aggregates_member_outputs() {
    let (app, state) = common::test_app_with_state();
    let tok = common::login_token(&app);

    let (status, created) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({
            "name": "Main",
            "colour_index": 2,
            "tx_ids": ["tx_0", "tx_1"]
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let zone_id = created
        .get("id")
        .and_then(|v| v.as_str())
        .expect("created zone must have id");

    {
        let mut meters = state.meters.write().await;
        meters.tx_rms[0] = linear(-12.0);
        meters.tx_rms[1] = linear(-6.0);
        meters.tx_peak[0] = linear(-3.0);
        meters.tx_peak[1] = linear(-1.0);
        meters.tx_gr_db[0] = -2.0;
        meters.tx_gr_db[1] = -5.0;
        meters.tx_clip_count[0] = 1;
        meters.tx_clip_count[1] = 4;
    }

    let (status, json) = common::get_json(&app, "/api/v1/zones/metering", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let rows = json.as_array().expect("metering rows");
    let zone = rows
        .iter()
        .find(|row| row.get("id").and_then(|v| v.as_str()) == Some(zone_id))
        .expect("matching zone metering row");

    let rms_db = zone.get("rms_db").and_then(|v| v.as_f64()).expect("rms_db") as f32;
    let peak_db = zone
        .get("peak_db")
        .and_then(|v| v.as_f64())
        .expect("peak_db") as f32;
    let gr_db = zone.get("gr_db").and_then(|v| v.as_f64()).expect("gr_db") as f32;
    let clip_count = zone
        .get("clip_count")
        .and_then(|v| v.as_u64())
        .expect("clip_count");

    assert!((rms_db - (-6.0)).abs() < 0.2, "unexpected rms_db: {rms_db}");
    assert!(
        (peak_db - (-1.0)).abs() < 0.2,
        "unexpected peak_db: {peak_db}"
    );
    assert!((gr_db - (-5.0)).abs() < 0.1, "unexpected gr_db: {gr_db}");
    assert_eq!(clip_count, 5);
}
