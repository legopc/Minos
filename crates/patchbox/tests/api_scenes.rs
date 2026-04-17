mod common;

use axum::http::{Method, StatusCode};

#[tokio::test]
async fn scenes_save_list_load_delete_roundtrip() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    // Starts empty
    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("active").and_then(|v| v.as_str()), None);
    assert_eq!(
        json.get("scenes")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(0)
    );

    // Save
    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes",
        Some(serde_json::json!({"name":"scene1","description":"test"})),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let scenes = json
        .get("scenes")
        .and_then(|v| v.as_array())
        .expect("scenes must be array");
    assert_eq!(scenes.len(), 1);
    // Scene serialises with "name" (it has no separate "id" field; the name IS the key).
    assert!(scenes
        .iter()
        .any(|s| s.get("name").and_then(|v| v.as_str()) == Some("scene1")));

    // Load
    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/scene1/load",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("active").and_then(|v| v.as_str()), Some("scene1"));

    // Delete
    let (status, _resp, _bytes) = common::send(
        &app,
        Method::DELETE,
        "/api/v1/scenes/scene1",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json.get("scenes")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(0)
    );
    assert_eq!(json.get("active").and_then(|v| v.as_str()), None);
}
