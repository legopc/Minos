mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn zone_ids_are_stable_and_monotonic() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Fixture normalize() auto-derives 2 zones (zone_0, zone_1).
    let (status, json) = common::get_json(&app, "/api/v1/zones", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = json.as_array().expect("zones list must be array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0].get("id").and_then(|v| v.as_str()), Some("zone_0"));
    assert_eq!(arr[1].get("id").and_then(|v| v.as_str()), Some("zone_1"));

    // Create → allocates next monotonic id (zone_2).
    let (status, created) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({
            "name": "Group A",
            "tx_ids": ["tx_0"]
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created.get("id").and_then(|v| v.as_str()), Some("zone_2"));

    // Delete an early ID.
    let status = common::delete(&app, "/api/v1/zones/zone_0", Some(&tok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Update by stable ID must still work after delete shifts vec positions.
    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/zones/zone_1",
        serde_json::json!({"name": "Renamed"}),
        Some(&tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );

    // Create again → must not reuse deleted IDs.
    let (status, created) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({
            "name": "Group B",
            "tx_ids": ["tx_1"]
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created.get("id").and_then(|v| v.as_str()), Some("zone_3"));

    // Verify IDs present/absent as expected.
    let (status, json) = common::get_json(&app, "/api/v1/zones", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<String> = json
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|z| z.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();

    assert!(
        !ids.iter().any(|s| s == "zone_0"),
        "zone_0 should be deleted"
    );
    assert!(ids.iter().any(|s| s == "zone_1"), "zone_1 should remain");
    assert!(ids.iter().any(|s| s == "zone_2"), "zone_2 should remain");
    assert!(ids.iter().any(|s| s == "zone_3"), "zone_3 should exist");
}
