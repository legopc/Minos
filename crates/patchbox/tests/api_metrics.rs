mod common;

use axum::http::StatusCode;
use std::sync::atomic::Ordering;

#[tokio::test]
async fn metrics_returns_runtime_counters_in_dedicated_shape() {
    let (app, state) = common::test_app_with_state();

    state.dante_connected.store(true, Ordering::Relaxed);
    state.audio_callbacks.store(123, Ordering::Relaxed);
    state.resyncs.store(7, Ordering::Relaxed);
    state.dsp_metrics.update_block_cpu(250, 1000);
    state.dsp_metrics.increment_xruns();

    let (status, json) = common::get_json(&app, "/api/v1/metrics", None).await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(
        json.pointer("/dante/connected").and_then(|v| v.as_bool()),
        Some(true)
    );
    assert_eq!(
        json.pointer("/audio/callbacks_total")
            .and_then(|v| v.as_u64()),
        Some(123)
    );
    assert_eq!(
        json.pointer("/audio/resyncs").and_then(|v| v.as_u64()),
        Some(7)
    );
    assert_eq!(json.pointer("/dsp/xruns").and_then(|v| v.as_u64()), Some(1));
    assert!(json
        .pointer("/dsp/cpu_percent")
        .and_then(|v| v.as_f64())
        .is_some());
    assert!(json.pointer("/status").and_then(|v| v.as_str()).is_some());
    assert!(json.pointer("/version").and_then(|v| v.as_str()).is_some());
    assert!(json
        .pointer("/uptime_secs")
        .and_then(|v| v.as_u64())
        .is_some());
    assert!(
        json.get("zones").is_none(),
        "metrics response should stay dedicated"
    );
}

#[tokio::test]
async fn prometheus_metrics_exposes_expected_series() {
    let (app, state) = common::test_app_with_state();

    state.dante_connected.store(true, Ordering::Relaxed);
    state.audio_callbacks.store(321, Ordering::Relaxed);
    state.resyncs.store(9, Ordering::Relaxed);
    state.dsp_metrics.update_block_cpu(500, 1000);
    state.dsp_metrics.increment_xruns();
    state.dsp_metrics.increment_xruns();

    let (status, _resp, bytes) = common::send(
        &app,
        axum::http::Method::GET,
        "/api/v1/metrics/prometheus",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let body = String::from_utf8(bytes).expect("prometheus response must be utf-8");
    assert!(body.contains("patchbox_info{"));
    assert!(body.contains("patchbox_dante_connected 1"));
    assert!(body.contains("patchbox_audio_callbacks_total 321"));
    assert!(body.contains("patchbox_audio_resyncs_total 9"));
    assert!(body.contains("patchbox_dsp_xruns_total 2"));
}
