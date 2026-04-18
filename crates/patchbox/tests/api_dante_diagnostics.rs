mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn dante_diagnostics_unauthenticated_returns_401() {
    let app = common::test_app();

    let (status, json) = common::get_json(&app, "/api/v1/system/dante/diagnostics", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        json.get("error").and_then(|v| v.as_str()).is_some(),
        "expected ErrorResponse {{ error, .. }}, got: {json}"
    );
}

#[tokio::test]
async fn dante_diagnostics_returns_expected_shape() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, json) =
        common::get_json(&app, "/api/v1/system/dante/diagnostics", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);

    assert!(json.get("generated_at").and_then(|v| v.as_str()).is_some());

    for k in ["device", "network", "ptp"] {
        let card = json
            .get(k)
            .and_then(|v| v.as_object())
            .expect("card object");
        assert!(
            card.get("level").and_then(|v| v.as_str()).is_some(),
            "{k}.level"
        );
        assert!(
            card.get("summary").and_then(|v| v.as_str()).is_some(),
            "{k}.summary"
        );
        assert!(
            card.get("items").and_then(|v| v.as_array()).is_some(),
            "{k}.items"
        );
    }

    let hist = json
        .get("ptp_history")
        .and_then(|v| v.as_array())
        .expect("ptp_history array");
    let event_log = json
        .get("event_log")
        .and_then(|v| v.as_array())
        .expect("event_log array");
    let actions = json
        .get("recovery_actions")
        .and_then(|v| v.as_array())
        .expect("recovery_actions array");
    assert!(actions.len() >= 3, "expected recovery actions, got: {json}");
    if let Some(entry) = event_log.first().and_then(|v| v.as_object()) {
        assert!(entry.get("ts_ms").and_then(|v| v.as_u64()).is_some());
        assert!(entry.get("level").and_then(|v| v.as_str()).is_some());
        assert!(entry.get("message").and_then(|v| v.as_str()).is_some());
    }
    for action in actions {
        let action = action.as_object().expect("action object");
        assert!(
            action.get("id").and_then(|v| v.as_str()).is_some(),
            "action.id"
        );
        assert!(
            action.get("label").and_then(|v| v.as_str()).is_some(),
            "action.label"
        );
        assert!(
            action.get("description").and_then(|v| v.as_str()).is_some(),
            "action.description"
        );
    }

    // Ring buffer starts empty in test harness; if it isn't empty, ensure sample shape.
    if let Some(s) = hist.first().and_then(|v| v.as_object()) {
        assert!(s.get("ts_ms").and_then(|v| v.as_u64()).is_some());
        assert!(s.get("locked").and_then(|v| v.as_bool()).is_some());
    }
}

#[tokio::test]
async fn dante_recovery_action_unauthenticated_returns_401() {
    let app = common::test_app();

    let (status, json) = common::post_json(
        &app,
        "/api/v1/system/dante/recovery-actions/rescan",
        serde_json::json!({}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(json.get("error").and_then(|v| v.as_str()).is_some());
}

#[tokio::test]
async fn dante_recovery_action_operator_returns_403() {
    let app = common::test_app();
    let tok = common::operator_token();

    let (status, json) = common::post_json(
        &app,
        "/api/v1/system/dante/recovery-actions/rescan",
        serde_json::json!({}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        json.get("error").and_then(|v| v.as_str()),
        Some("insufficient_role")
    );
}

#[tokio::test]
async fn dante_recovery_rescan_appends_ptp_history() {
    let app = common::test_app();
    let tok = common::admin_token();

    let (status, json) = common::post_json(
        &app,
        "/api/v1/system/dante/recovery-actions/rescan",
        serde_json::json!({}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("ok").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(json.get("action").and_then(|v| v.as_str()), Some("rescan"));

    let (status, json) =
        common::get_json(&app, "/api/v1/system/dante/diagnostics", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let hist = json
        .get("ptp_history")
        .and_then(|v| v.as_array())
        .expect("ptp_history array");
    assert_eq!(
        hist.len(),
        1,
        "expected rescan sample in history, got: {json}"
    );
    let event_log = json
        .get("event_log")
        .and_then(|v| v.as_array())
        .expect("event_log array");
    assert!(
        event_log.iter().any(|entry| {
            entry.get("message").and_then(|v| v.as_str()) == Some("Recovery action: rescan")
        }),
        "expected rescan event in log, got: {json}"
    );
}

#[tokio::test]
async fn dante_recovery_rebind_returns_200() {
    let app = common::test_app();
    let tok = common::admin_token();

    let (status, json) = common::post_json(
        &app,
        "/api/v1/system/dante/recovery-actions/rebind",
        serde_json::json!({}),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("action").and_then(|v| v.as_str()), Some("rebind"));
}
