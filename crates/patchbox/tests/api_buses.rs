mod common;

use axum::http::{Method, StatusCode};

#[tokio::test]
async fn buses_crud_roundtrip() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Fixture starts with one bus: bus_0
    let (status, json) = common::get_json(&app, "/api/v1/buses", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = json.as_array().expect("buses must be array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0].get("id").and_then(|v| v.as_str()), Some("bus_0"));

    // Create
    let (status, created) = common::post_json(
        &app,
        "/api/v1/buses",
        serde_json::json!({"name":"Bus 2"}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created.get("id").and_then(|v| v.as_str()), Some("bus_1"));
    assert_eq!(created.get("name").and_then(|v| v.as_str()), Some("Bus 2"));
    assert_eq!(
        created
            .get("routing")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(2)
    );

    // Read
    let (status, json) = common::get_json(&app, "/api/v1/buses/bus_1", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("id").and_then(|v| v.as_str()), Some("bus_1"));

    // Update
    let (status, _bytes) = common::put_json(
        &app,
        "/api/v1/buses/bus_1",
        serde_json::json!({"name":"Submix","muted":true}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = common::get_json(&app, "/api/v1/buses/bus_1", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("name").and_then(|v| v.as_str()), Some("Submix"));
    assert_eq!(json.get("muted").and_then(|v| v.as_bool()), Some(true));

    // Delete
    let status = common::delete(&app, "/api/v1/buses/bus_1", Some(&tok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, _resp, _bytes) =
        common::send(&app, Method::GET, "/api/v1/buses/bus_1", None, Some(&tok)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Back to fixture only
    let (status, json) = common::get_json(&app, "/api/v1/buses", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let arr = json.as_array().expect("buses must be array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0].get("id").and_then(|v| v.as_str()), Some("bus_0"));
}
