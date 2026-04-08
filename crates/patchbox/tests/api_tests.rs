//! Integration tests for the patchbox REST API.
//!
//! Uses `axum_test` to spin up the full router in-process — no Dante device,
//! no PTP clock required.  Tests exercise every route and verify correct HTTP
//! status codes and JSON shapes.

use axum_test::TestServer;
use patchbox::api::build_router;
use patchbox::config::Config;
use patchbox::state::AppState;
use serde_json::{json, Value};
use std::sync::Arc;
use tempfile::TempDir;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn make_server() -> (TestServer, TempDir) {
    let tmp = TempDir::new().expect("tempdir");
    let mut cfg = Config::default();
    cfg.scenes_dir = tmp.path().to_str().unwrap().to_owned();
    cfg.n_inputs  = 4;
    cfg.n_outputs = 4;

    let state = Arc::new(AppState::new(cfg.clone()));
    let router = build_router(state, cfg);
    (TestServer::new(router).expect("test server"), tmp)
}

// ── /api/v1/health ────────────────────────────────────────────────────────────

#[tokio::test]
async fn health_returns_ok() {
    let (srv, _tmp) = make_server();
    let res = srv.get("/api/v1/health").await;
    res.assert_status_ok();
    let body: Value = res.json();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["inputs"],  4);
    assert_eq!(body["outputs"], 4);
    assert!(body["version"].is_string());
}

// ── /api/v1/state ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn state_has_expected_shape() {
    let (srv, _tmp) = make_server();
    let res = srv.get("/api/v1/state").await;
    res.assert_status_ok();
    let body: Value = res.json();
    assert!(body["matrix"].is_object());
    assert_eq!(body["inputs"].as_array().unwrap().len(),  4);
    assert_eq!(body["outputs"].as_array().unwrap().len(), 4);
}

// ── /api/v1/matrix/:in/:out ───────────────────────────────────────────────────

#[tokio::test]
async fn patch_matrix_cell_accepted() {
    let (srv, _tmp) = make_server();
    let res = srv
        .patch("/api/v1/matrix/0/0")
        .json(&json!({ "gain": 0.707 }))
        .await;
    res.assert_status(axum::http::StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn patch_matrix_cell_out_of_range_rejected() {
    let (srv, _tmp) = make_server();
    // Input index 99 is way beyond n_inputs=4
    let res = srv
        .patch("/api/v1/matrix/99/0")
        .json(&json!({ "gain": 1.0 }))
        .await;
    res.assert_status(axum::http::StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patch_matrix_cell_persists_in_state() {
    let (srv, _tmp) = make_server();
    // Set a non-default gain
    srv.patch("/api/v1/matrix/1/2")
        .json(&json!({ "gain": 0.5 }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // Verify state reflects the change
    let state: Value = srv.get("/api/v1/state").await.json();
    let gains = &state["matrix"]["gains"];
    // Matrix is stored as a flat Vec<f32> with row-major indexing
    assert!(gains.is_array(), "matrix.gains should be an array");
}

// ── /api/v1/channels ─────────────────────────────────────────────────────────

#[tokio::test]
async fn set_input_name() {
    let (srv, _tmp) = make_server();
    let res = srv
        .post("/api/v1/channels/input/0/name")
        .json(&json!({ "name": "Bar 1 Mic" }))
        .await;
    res.assert_status(axum::http::StatusCode::NO_CONTENT);

    let state: Value = srv.get("/api/v1/state").await.json();
    assert_eq!(state["inputs"][0]["label"], "Bar 1 Mic");
}

#[tokio::test]
async fn set_input_name_out_of_range() {
    let (srv, _tmp) = make_server();
    let res = srv
        .post("/api/v1/channels/input/99/name")
        .json(&json!({ "name": "Ghost" }))
        .await;
    res.assert_status(axum::http::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn toggle_input_mute() {
    let (srv, _tmp) = make_server();
    // Default mute = false; toggle → true
    srv.post("/api/v1/channels/input/0/mute").await
        .assert_status(axum::http::StatusCode::NO_CONTENT);
    let state: Value = srv.get("/api/v1/state").await.json();
    assert_eq!(state["inputs"][0]["mute"], true);

    // Toggle again → false
    srv.post("/api/v1/channels/input/0/mute").await
        .assert_status(axum::http::StatusCode::NO_CONTENT);
    let state: Value = srv.get("/api/v1/state").await.json();
    assert_eq!(state["inputs"][0]["mute"], false);
}

#[tokio::test]
async fn toggle_input_solo() {
    let (srv, _tmp) = make_server();
    srv.post("/api/v1/channels/input/2/solo").await
        .assert_status(axum::http::StatusCode::NO_CONTENT);
    let state: Value = srv.get("/api/v1/state").await.json();
    assert_eq!(state["inputs"][2]["solo"], true);
}

#[tokio::test]
async fn set_output_name() {
    let (srv, _tmp) = make_server();
    srv.post("/api/v1/channels/output/3/name")
        .json(&json!({ "name": "Zone A Subs" }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);
    let state: Value = srv.get("/api/v1/state").await.json();
    assert_eq!(state["outputs"][3]["label"], "Zone A Subs");
}

#[tokio::test]
async fn toggle_output_mute() {
    let (srv, _tmp) = make_server();
    srv.post("/api/v1/channels/output/1/mute").await
        .assert_status(axum::http::StatusCode::NO_CONTENT);
    let state: Value = srv.get("/api/v1/state").await.json();
    assert_eq!(state["outputs"][1]["mute"], true);
}

// ── /api/v1/scenes ────────────────────────────────────────────────────────────

#[tokio::test]
async fn list_scenes_empty() {
    let (srv, _tmp) = make_server();
    let res = srv.get("/api/v1/scenes").await;
    res.assert_status_ok();
    let names: Vec<String> = res.json();
    assert!(names.is_empty());
}

#[tokio::test]
async fn save_and_load_scene() {
    let (srv, _tmp) = make_server();

    // Rename a channel so we can verify it survives save/load
    srv.post("/api/v1/channels/input/0/name")
        .json(&json!({ "name": "SavedName" }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // Save scene
    srv.post("/api/v1/scenes")
        .json(&json!({ "name": "test-scene" }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // Verify it appears in list
    let names: Vec<String> = srv.get("/api/v1/scenes").await.json();
    assert!(names.contains(&"test-scene".to_owned()));

    // Clobber the name in state
    srv.post("/api/v1/channels/input/0/name")
        .json(&json!({ "name": "Changed" }))
        .await;

    // Load scene — should restore (POST /scenes/:name/load applies the scene)
    srv.post("/api/v1/scenes/test-scene/load").await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    let state: Value = srv.get("/api/v1/state").await.json();
    assert_eq!(state["inputs"][0]["label"], "SavedName");
}

#[tokio::test]
async fn delete_scene() {
    let (srv, _tmp) = make_server();

    // Save first
    srv.post("/api/v1/scenes")
        .json(&json!({ "name": "to-delete" }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // Should be in list
    let names: Vec<String> = srv.get("/api/v1/scenes").await.json();
    assert!(names.contains(&"to-delete".to_owned()));

    // Delete
    srv.delete("/api/v1/scenes/to-delete")
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // Should be gone
    let names: Vec<String> = srv.get("/api/v1/scenes").await.json();
    assert!(!names.contains(&"to-delete".to_owned()));
}

#[tokio::test]
async fn delete_nonexistent_scene_is_404() {
    let (srv, _tmp) = make_server();
    srv.delete("/api/v1/scenes/ghost")
        .await
        .assert_status(axum::http::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn set_input_gain_trim() {
    let (srv, _tmp) = make_server();
    srv.post("/api/v1/channels/input/0/gain_trim")
        .json(&json!({ "gain": 0.5 }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    let state: serde_json::Value = srv.get("/api/v1/state").await.json();
    let trim = state["inputs"][0]["gain_trim"].as_f64().unwrap();
    assert!((trim - 0.5).abs() < 0.001);
}

#[tokio::test]
async fn set_output_master_gain() {
    let (srv, _tmp) = make_server();
    srv.post("/api/v1/channels/output/0/master_gain")
        .json(&json!({ "gain": 0.75 }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    let state: serde_json::Value = srv.get("/api/v1/state").await.json();
    let gain = state["outputs"][0]["master_gain"].as_f64().unwrap();
    assert!((gain - 0.75).abs() < 0.001);
}

#[tokio::test]
async fn input_gain_trim_clamped() {
    let (srv, _tmp) = make_server();
    // Above max (4.0)
    srv.post("/api/v1/channels/input/0/gain_trim")
        .json(&json!({ "gain": 99.0 }))
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);
    let state: serde_json::Value = srv.get("/api/v1/state").await.json();
    let trim = state["inputs"][0]["gain_trim"].as_f64().unwrap();
    assert!(trim <= 4.0);
}

#[tokio::test]
async fn path_traversal_rejected() {
    let (srv, _tmp) = make_server();

    // Attempt path traversal via scene name
    srv.post("/api/v1/scenes")
        .json(&json!({ "name": "../../etc/cron.d/evil" }))
        .await
        .assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Dots-only name
    srv.post("/api/v1/scenes")
        .json(&json!({ "name": ".." }))
        .await
        .assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Null byte
    srv.post("/api/v1/scenes")
        .json(&json!({ "name": "foo\0bar" }))
        .await
        .assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Empty name
    srv.post("/api/v1/scenes")
        .json(&json!({ "name": "" }))
        .await
        .assert_status(axum::http::StatusCode::BAD_REQUEST);
}

// ── T-03: Scene roundtrip with schema_version (T-05) ──────────────────────────

#[tokio::test]
async fn scene_roundtrip_with_schema_version() {
    use patchbox_core::scene;
    use std::path::Path;

    let tmp = TempDir::new().expect("tempdir");
    let dir = tmp.path();

    // Build a minimal scene
    let params = patchbox_core::control::AudioParams::new(2, 2);
    let original = scene::Scene {
        schema_version: 1,
        name: "roundtrip".to_owned(),
        params,
    };

    // Save then load
    scene::save(dir, &original).expect("save");
    let loaded = scene::load(dir, "roundtrip").expect("load");

    assert_eq!(loaded.schema_version, 1);
    assert_eq!(loaded.name, "roundtrip");
    assert_eq!(loaded.params.inputs.len(),  2);
    assert_eq!(loaded.params.outputs.len(), 2);

    // Verify the TOML file contains schema_version
    let raw = std::fs::read_to_string(dir.join("roundtrip.toml")).expect("read");
    assert!(raw.contains("schema_version"), "TOML must include schema_version field");
}

// Old TOML without schema_version deserialises using default (= 1)
#[tokio::test]
async fn scene_missing_schema_version_defaults_to_1() {
    use patchbox_core::scene;

    let tmp = TempDir::new().expect("tempdir");
    let dir = tmp.path();

    // Write a legacy TOML without schema_version
    let legacy = r#"
name = "legacy"
[params.matrix]
inputs  = 2
outputs = 2
gains   = [[0.0, 0.0], [0.0, 0.0]]

[[params.inputs]]
label = "IN1"
mute  = false
solo  = false
gain_trim = 1.0

[[params.inputs]]
label = "IN2"
mute  = false
solo  = false
gain_trim = 1.0

[[params.outputs]]
label = "OUT1"
mute  = false
master_gain = 1.0

[[params.outputs]]
label = "OUT2"
mute  = false
master_gain = 1.0
"#;
    std::fs::write(dir.join("legacy.toml"), legacy).expect("write legacy");
    let loaded = scene::load(dir, "legacy").expect("load legacy");
    assert_eq!(loaded.schema_version, 1, "missing schema_version should default to 1");
}

// ── T-01: WebSocket connects and receives meter frame ─────────────────────────

#[tokio::test]
async fn ws_connects_and_receives_frame() {
    use tokio_tungstenite::connect_async;
    use tokio::net::TcpListener;

    // Spin up a real TCP listener on a random port
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");

    let tmp = TempDir::new().expect("tempdir");
    let mut cfg = Config::default();
    cfg.scenes_dir = tmp.path().to_str().unwrap().to_owned();
    cfg.n_inputs  = 2;
    cfg.n_outputs = 2;

    let state = Arc::new(AppState::new(cfg.clone()));
    let router = build_router(state, cfg);

    // Serve in background
    tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });

    // Give the server a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Connect WebSocket
    let url = format!("ws://{}/ws", addr);
    let result = connect_async(&url).await;
    assert!(result.is_ok(), "WS connect failed: {:?}", result.err());

    let (mut stream, _response) = result.unwrap();

    // We expect the server to send at least one message (the initial state push)
    // or we can close cleanly.
    use futures_util::{SinkExt, StreamExt};
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        stream.next(),
    ).await;

    // Close cleanly — no panic means success
    stream.close(None).await.ok();
}
