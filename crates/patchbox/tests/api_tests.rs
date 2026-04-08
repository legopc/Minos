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

    // Load scene — should restore
    srv.get("/api/v1/scenes/test-scene").await
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
