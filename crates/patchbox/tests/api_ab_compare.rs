mod common;

use axum::http::{Method, StatusCode};
use tokio::time::{sleep, Duration};

async fn capture_slot(app: &axum::Router, bearer: &str, slot: &str) -> serde_json::Value {
    let (status, json) = common::post_json(
        app,
        &format!("/api/v1/scenes/ab/capture?slot={slot}"),
        serde_json::json!({ "source": "live" }),
        Some(bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json
}

#[tokio::test]
async fn ab_capture_toggle_and_diff_work() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    {
        let mut cfg = state.config.write().await;
        cfg.matrix = vec![vec![true, false], vec![false, false]];
        cfg.matrix_gain_db = vec![vec![0.0, 0.0], vec![0.0, 0.0]];
        cfg.output_dsp[0].gain_db = -3.0;
        cfg.output_dsp[1].gain_db = 1.0;
        cfg.output_dsp[0].muted = false;
        cfg.output_dsp[1].muted = false;
        cfg.output_gain_db = cfg.output_dsp.iter().map(|dsp| dsp.gain_db).collect();
        cfg.output_muted = cfg.output_dsp.iter().map(|dsp| dsp.muted).collect();
    }
    let capture_a = capture_slot(&app, &tok, "a").await;
    assert_eq!(capture_a.get("slot").and_then(|value| value.as_str()), Some("a"));

    {
        let mut cfg = state.config.write().await;
        cfg.matrix = vec![vec![false, true], vec![true, false]];
        cfg.matrix_gain_db = vec![vec![-12.0, 0.0], vec![3.0, 0.0]];
        cfg.output_dsp[0].gain_db = -18.0;
        cfg.output_dsp[1].gain_db = 6.0;
        cfg.output_dsp[0].muted = true;
        cfg.output_dsp[1].muted = false;
        cfg.output_gain_db = cfg.output_dsp.iter().map(|dsp| dsp.gain_db).collect();
        cfg.output_muted = cfg.output_dsp.iter().map(|dsp| dsp.muted).collect();
    }
    let capture_b = capture_slot(&app, &tok, "b").await;
    assert_eq!(capture_b.get("slot").and_then(|value| value.as_str()), Some("b"));

    let (status, state_json) = common::get_json(&app, "/api/v1/scenes/ab", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(state_json.get("slot_a").is_some());
    assert!(state_json.get("slot_b").is_some());

    let (status, diff) = common::get_json(&app, "/api/v1/scenes/ab/diff", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(diff.get("has_changes").and_then(|value| value.as_bool()), Some(true));

    let (status, toggled) =
        common::post_json(&app, "/api/v1/scenes/ab/toggle", serde_json::json!({}), Some(&tok))
            .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(toggled.get("active").and_then(|value| value.as_str()), Some("b"));

    let cfg = state.config.read().await;
    assert_eq!(cfg.matrix, vec![vec![false, true], vec![true, false]]);
    assert_eq!(cfg.output_gain_db, vec![-18.0, 6.0]);
    assert_eq!(cfg.output_muted, vec![true, false]);
}

#[tokio::test]
async fn ab_morph_start_and_cancel_leave_valid_state() {
    let (app, state) = common::test_app_with_state();
    let tok = common::admin_token();

    {
        let mut cfg = state.config.write().await;
        cfg.matrix = vec![vec![true, false], vec![false, false]];
        cfg.matrix_gain_db = vec![vec![0.0, 0.0], vec![0.0, 0.0]];
        cfg.output_dsp[0].gain_db = -6.0;
        cfg.output_dsp[1].gain_db = 0.0;
        cfg.output_dsp[0].muted = false;
        cfg.output_dsp[1].muted = false;
        cfg.output_gain_db = cfg.output_dsp.iter().map(|dsp| dsp.gain_db).collect();
        cfg.output_muted = cfg.output_dsp.iter().map(|dsp| dsp.muted).collect();
    }
    capture_slot(&app, &tok, "a").await;

    {
        let mut cfg = state.config.write().await;
        cfg.matrix = vec![vec![false, true], vec![true, false]];
        cfg.matrix_gain_db = vec![vec![-18.0, 0.0], vec![6.0, 0.0]];
        cfg.output_dsp[0].gain_db = 6.0;
        cfg.output_dsp[1].gain_db = -18.0;
        cfg.output_dsp[0].muted = true;
        cfg.output_dsp[1].muted = false;
        cfg.output_gain_db = cfg.output_dsp.iter().map(|dsp| dsp.gain_db).collect();
        cfg.output_muted = cfg.output_dsp.iter().map(|dsp| dsp.muted).collect();
    }
    capture_slot(&app, &tok, "b").await;

    let (status, started) = common::post_json(
        &app,
        "/api/v1/scenes/ab/morph",
        serde_json::json!({
            "direction": "b_to_a",
            "duration_ms": 200,
            "scope": {
                "routing": true,
                "inputs": false,
                "outputs": true,
                "buses": false,
                "groups": false,
                "generators": false
            }
        }),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        started.get("active_target").and_then(|value| value.as_str()),
        Some("a")
    );

    sleep(Duration::from_millis(80)).await;

    let (status, _resp, bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/ab/morph/cancel",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {}", String::from_utf8_lossy(&bytes));
    let cancelled: serde_json::Value = serde_json::from_slice(&bytes).expect("cancel json");
    let cancelled_at_t = cancelled
        .get("cancelled_at_t")
        .and_then(|value| value.as_f64())
        .expect("cancelled_at_t") as f32;
    assert!(cancelled_at_t > 0.0 && cancelled_at_t <= 1.0);

    let (status, state_json) = common::get_json(&app, "/api/v1/scenes/ab", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(state_json.get("morph").is_none() || state_json.get("morph") == Some(&serde_json::Value::Null));

    let cfg = state.config.read().await;
    assert!(cfg.output_dsp[0].gain_db.is_finite());
    assert!(cfg.output_dsp[1].gain_db.is_finite());
    assert!(cfg.output_dsp[0].gain_db >= -6.0 && cfg.output_dsp[0].gain_db <= 6.0);
    assert!(cfg.output_dsp[1].gain_db >= -18.0 && cfg.output_dsp[1].gain_db <= 0.0);
}
