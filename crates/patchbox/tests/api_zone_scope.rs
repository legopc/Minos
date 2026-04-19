mod common;

use axum::{
    http::{Method, StatusCode},
    Router,
};

fn json_from_bytes(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).expect("valid json")
}

fn assert_zone_scope_forbidden(
    json: &serde_json::Value,
    zone_id: &str,
    target_zone_id: Option<&str>,
) {
    assert_eq!(
        json.get("error").and_then(|value| value.as_str()),
        Some("zone_scope_forbidden")
    );
    assert_eq!(
        json.get("zone").and_then(|value| value.as_str()),
        Some(zone_id)
    );
    assert_eq!(
        json.get("target").and_then(|value| value.as_str()),
        target_zone_id
    );
}

async fn create_zone(app: &Router, bearer: &str, name: &str, tx_ids: &[&str]) -> String {
    let (status, created) = common::post_json(
        app,
        "/api/v1/zones",
        serde_json::json!({
            "name": name,
            "tx_ids": tx_ids,
        }),
        Some(bearer),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    created
        .get("id")
        .and_then(|value| value.as_str())
        .expect("zone id")
        .to_string()
}

async fn create_template(app: &Router, bearer: &str, name: &str) -> String {
    let (status, created) = common::post_json(
        app,
        "/api/v1/zones/templates",
        serde_json::json!({
            "name": name,
            "output": {
                "gain_db": -6.0,
                "muted": false,
            }
        }),
        Some(bearer),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    created
        .get("id")
        .and_then(|value| value.as_str())
        .expect("template id")
        .to_string()
}

#[tokio::test]
async fn zone_scoped_user_is_limited_to_claimed_zone_output_and_route_mutations() {
    let app = common::test_app();
    let admin = common::admin_token();
    let zone_a = create_zone(&app, &admin, "Bar A", &["tx_0"]).await;
    let zone_b = create_zone(&app, &admin, "Bar B", &["tx_1"]).await;
    let zone_tok = common::zone_operator_token(&zone_a);

    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/outputs/0/mute",
        serde_json::json!({ "muted": true }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );

    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/outputs/1/gain",
        serde_json::json!({ "gain_db": -12.0 }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
    let json = json_from_bytes(&bytes);
    assert_zone_scope_forbidden(&json, &zone_a, Some(&zone_b));

    let (status, bytes) = common::put_json(
        &app,
        "/api/v1/zones/1/eq/enabled",
        serde_json::json!({ "enabled": true }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
    let json = json_from_bytes(&bytes);
    assert_zone_scope_forbidden(&json, &zone_a, Some(&zone_b));

    let (status, _json) = common::post_json(
        &app,
        "/api/v1/routes",
        serde_json::json!({ "rx_id": "rx_0", "tx_id": "tx_0" }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/routes",
        serde_json::json!({ "rx_id": "rx_0", "tx_id": "tx_1" }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_zone_scope_forbidden(&json, &zone_a, Some(&zone_b));
}

#[tokio::test]
async fn zone_scoped_user_cannot_use_global_zone_catalog_or_scene_mutations() {
    let app = common::test_app();
    let admin = common::admin_token();
    let zone_a = create_zone(&app, &admin, "Bar A", &["tx_0"]).await;
    let zone_b = create_zone(&app, &admin, "Bar B", &["tx_1"]).await;
    let template_id = create_template(&app, &admin, "Speech").await;
    let zone_tok = common::zone_operator_token(&zone_a);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/bulk",
        serde_json::json!({
            "operation": "set_all_outputs_muted",
            "muted": true
        }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_zone_scope_forbidden(&json, &zone_a, None);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/bulk",
        serde_json::json!({
            "operation": "set_zone_outputs_muted",
            "zone_id": zone_a.clone(),
            "muted": true
        }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json.get("affected").and_then(|value| value.as_u64()),
        Some(1)
    );

    let (status, json) = common::post_json(
        &app,
        "/api/v1/bulk",
        serde_json::json!({
            "operation": "apply_zone_template",
            "zone_id": zone_b.clone(),
            "template_id": template_id.clone()
        }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_zone_scope_forbidden(&json, &zone_a, Some(&zone_b));

    let (status, json) = common::post_json(
        &app,
        "/api/v1/zones",
        serde_json::json!({ "name": "Sneaky", "tx_ids": ["tx_0"] }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_zone_scope_forbidden(&json, &zone_a, None);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/scenes",
        serde_json::json!({ "name": "staff-scene" }),
        Some(&zone_tok),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_zone_scope_forbidden(&json, &zone_a, None);

    let (status, _json) = common::post_json(
        &app,
        "/api/v1/scenes",
        serde_json::json!({ "name": "global-scene" }),
        Some(&admin),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _resp, bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/global-scene/load",
        None,
        Some(&zone_tok),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "body: {}",
        String::from_utf8_lossy(&bytes)
    );
    let json = json_from_bytes(&bytes);
    assert_zone_scope_forbidden(&json, &zone_a, None);
}
