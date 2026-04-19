mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn zone_template_crud_lists_and_audits() {
    let (app, _state) = common::test_app_with_state();
    let tok = common::admin_token();

    let (status, created) = common::post_json(
        &app,
        "/api/v1/zones/templates",
        serde_json::json!({
            "name":"Music",
            "colour_index": 4,
            "output": {
                "gain_db": -6.0,
                "muted": false,
                "eq": {
                    "enabled": true,
                    "bands": [
                        {"freq_hz": 1000.0, "gain_db": 1.5, "q": 0.8, "band_type": "Peaking"}
                    ]
                },
                "limiter": {
                    "enabled": true,
                    "threshold_db": -3.0,
                    "attack_ms": 1.0,
                    "release_ms": 120.0
                }
            }
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let template_id = created
        .get("id")
        .and_then(|v| v.as_str())
        .expect("template id")
        .to_string();

    let (status, list) = common::get_json(&app, "/api/v1/zones/templates", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let templates = list.as_array().expect("templates array");
    assert_eq!(templates.len(), 1);
    assert_eq!(
        templates[0].get("id").and_then(|v| v.as_str()),
        Some(template_id.as_str())
    );
    assert_eq!(
        templates[0]
            .pointer("/output/gain_db")
            .and_then(|v| v.as_f64()),
        Some(-6.0)
    );

    let status = common::delete(
        &app,
        &format!("/api/v1/zones/templates/{template_id}"),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, list) = common::get_json(&app, "/api/v1/zones/templates", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().map(|items| items.len()), Some(0));

    let (status, audit) = common::get_json(&app, "/api/v1/system/audit", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let entries = audit
        .get("entries")
        .and_then(|v| v.as_array())
        .expect("entries array");
    assert!(entries
        .iter()
        .any(|entry| entry.get("action").and_then(|v| v.as_str()) == Some("zone_template.create")));
    assert!(entries
        .iter()
        .any(|entry| entry.get("action").and_then(|v| v.as_str()) == Some("zone_template.delete")));
}
