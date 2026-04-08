use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use patchbox_core::scene;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;

use crate::state::SharedState;

pub fn api_router(state: SharedState) -> Router<SharedState> {
    Router::new()
        .route("/health",           get(health))
        .route("/state",            get(get_state))
        .route("/matrix/:in/:out",  patch(patch_matrix_cell))
        .route("/channels/input/:id/name",      post(set_input_name))
        .route("/channels/input/:id/mute",      post(toggle_input_mute))
        .route("/channels/input/:id/solo",      post(toggle_input_solo))
        .route("/channels/input/:id/gain_trim", post(set_input_gain_trim))
        .route("/channels/output/:id/name",     post(set_output_name))
        .route("/channels/output/:id/mute",     post(toggle_output_mute))
        .route("/channels/output/:id/master_gain", post(set_output_master_gain))
        .route("/scenes",           get(list_scenes).post(save_scene))
        .route("/scenes/:name",     get(load_scene).delete(delete_scene))
        // U-01: Zone-scoped view — returns state filtered to zone's outputs.
        .route("/zones",            get(list_zones))
        .route("/zones/:zone_id",   get(get_zone_state))
        .with_state(state)
}

// ── Health ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status:          &'static str,
    version:         &'static str,
    inputs:          usize,
    outputs:         usize,
    uptime_secs:     u64,
    ws_connections:  usize,
    scenes_dir_ok:   bool,
    /// D-02: PTP daemon health — `true` if statime is running (detected via process).
    ptp_ok:          bool,
    /// Statime lock status (offset from grandmaster in ns) if readable; None if unavailable.
    ptp_offset_ns:   Option<i64>,
}

async fn health(State(state): State<SharedState>) -> impl IntoResponse {
    let scenes_dir = state.scenes_dir();
    // Check scene dir is writable by probing with metadata; if it doesn't exist yet that's ok.
    let scenes_dir_ok = std::fs::create_dir_all(&scenes_dir).is_ok()
        && scenes_dir.metadata().map(|m| !m.permissions().readonly()).unwrap_or(false);

    let uptime_secs = state.started_at.elapsed().as_secs();
    let ws_connections = state.ws_connections.load(Ordering::Relaxed);

    // D-02: Check statime PTP daemon health via /run/statime/offset or process presence.
    let (ptp_ok, ptp_offset_ns) = check_ptp_health();

    // R-09: Prometheus metrics counters
    metrics::gauge!("patchbox_ws_connections").set(ws_connections as f64);
    metrics::gauge!("patchbox_uptime_seconds").set(uptime_secs as f64);
    if ptp_ok { metrics::gauge!("patchbox_ptp_ok").set(1.0); }
    else       { metrics::gauge!("patchbox_ptp_ok").set(0.0); }

    let body = HealthResponse {
        status:         "ok",
        version:        env!("CARGO_PKG_VERSION"),
        inputs:         state.config.n_inputs,
        outputs:        state.config.n_outputs,
        uptime_secs,
        ws_connections,
        scenes_dir_ok,
        ptp_ok,
        ptp_offset_ns,
    };
    Json(body)
}

/// D-02: Check if the statime PTP daemon is healthy.
///
/// Detection strategy (cheapest first):
/// 1. Try to read `/run/statime/offset` (written by statime when synced).
/// 2. Fall back to checking if a `statime` process is running via /proc.
fn check_ptp_health() -> (bool, Option<i64>) {
    // Attempt to read the offset file statime writes on each sync step.
    if let Ok(content) = std::fs::read_to_string("/run/statime/offset") {
        if let Ok(ns) = content.trim().parse::<i64>() {
            return (true, Some(ns));
        }
        // File exists but content is not a number — daemon running but no offset yet.
        return (true, None);
    }

    // Fallback: scan /proc for a process named "statime".
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                // Only look at numeric PIDs.
                if name.to_string_lossy().parse::<u32>().is_err() { continue; }
                let comm_path = entry.path().join("comm");
                if let Ok(comm) = std::fs::read_to_string(comm_path) {
                    if comm.trim() == "statime" {
                        return (true, None);
                    }
                }
            }
        }
    }

    (false, None)
}

// ── Full state snapshot ───────────────────────────────────────────────────

async fn get_state(State(state): State<SharedState>) -> impl IntoResponse {
    let params = state.params.read().await;
    Json(params.clone())
}

// ── Matrix cell ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GainBody {
    gain: f32,
}

async fn patch_matrix_cell(
    State(state): State<SharedState>,
    Path((input, output)): Path<(usize, usize)>,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    let mut params = state.params.write().await;
    let n_in  = params.matrix.inputs;
    let n_out = params.matrix.outputs;
    if input >= n_in || output >= n_out {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    params.matrix.set(input, output, body.gain.clamp(0.0, 4.0));
    StatusCode::NO_CONTENT.into_response()
}

// ── Channel strip controls ───────────────────────────────────────────────

#[derive(Deserialize)]
struct NameBody { name: String }

const MAX_LABEL_LEN: usize = 64;

async fn set_input_name(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(body): Json<NameBody>,
) -> impl IntoResponse {
    if body.name.len() > MAX_LABEL_LEN {
        return (StatusCode::BAD_REQUEST, "name exceeds 64 characters").into_response();
    }
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].label = body.name;
    StatusCode::NO_CONTENT.into_response()
}

async fn toggle_input_mute(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].mute = !p.inputs[id].mute;
    StatusCode::NO_CONTENT.into_response()
}

async fn toggle_input_solo(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].solo = !p.inputs[id].solo;
    StatusCode::NO_CONTENT.into_response()
}

async fn set_output_name(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(body): Json<NameBody>,
) -> impl IntoResponse {
    if body.name.len() > MAX_LABEL_LEN {
        return (StatusCode::BAD_REQUEST, "name exceeds 64 characters").into_response();
    }
    let mut p = state.params.write().await;
    if id >= p.outputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.outputs[id].label = body.name;
    StatusCode::NO_CONTENT.into_response()
}

async fn toggle_output_mute(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.outputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.outputs[id].mute = !p.outputs[id].mute;
    StatusCode::NO_CONTENT.into_response()
}

async fn set_input_gain_trim(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].gain_trim = body.gain.clamp(0.0, 4.0);
    StatusCode::NO_CONTENT.into_response()
}

async fn set_output_master_gain(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.outputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.outputs[id].master_gain = body.gain.clamp(0.0, 4.0);
    StatusCode::NO_CONTENT.into_response()
}

// ── Scenes ───────────────────────────────────────────────────────────────

async fn list_scenes(State(state): State<SharedState>) -> impl IntoResponse {
    let names = scene::list(&state.scenes_dir());
    Json(names)
}

#[derive(Deserialize)]
struct SaveSceneBody { name: String }

async fn save_scene(
    State(state): State<SharedState>,
    Json(body): Json<SaveSceneBody>,
) -> impl IntoResponse {
    match state.save_scene(&body.name).await {
        Ok(_)  => StatusCode::NO_CONTENT.into_response(),
        Err(scene::SceneError::InvalidName(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(e) => {
            tracing::error!("save_scene failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn load_scene(
    State(state): State<SharedState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    match state.load_scene(&name).await {
        Ok(_)  => StatusCode::NO_CONTENT.into_response(),
        Err(scene::SceneError::NotFound(_))    => StatusCode::NOT_FOUND.into_response(),
        Err(scene::SceneError::InvalidName(m)) => (StatusCode::BAD_REQUEST, m).into_response(),
        Err(e) => {
            tracing::error!("load_scene failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_scene(
    State(state): State<SharedState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    match scene::delete(&state.scenes_dir(), &name) {
        Ok(_)  => StatusCode::NO_CONTENT.into_response(),
        Err(scene::SceneError::NotFound(_))    => StatusCode::NOT_FOUND.into_response(),
        Err(scene::SceneError::InvalidName(m)) => (StatusCode::BAD_REQUEST, m).into_response(),
        Err(e) => {
            tracing::error!("delete_scene failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── U-01: Zone views ──────────────────────────────────────────────────────

#[derive(Serialize)]
struct ZoneInfo {
    id:      String,
    outputs: Vec<usize>,
}

/// GET /api/v1/zones — list configured zones.
async fn list_zones(State(state): State<SharedState>) -> impl IntoResponse {
    let zones: Vec<ZoneInfo> = state.config.zones
        .iter()
        .map(|(id, outputs)| ZoneInfo { id: id.clone(), outputs: outputs.clone() })
        .collect();
    Json(zones)
}

#[derive(Serialize)]
struct ZoneState {
    zone_id:  String,
    outputs:  Vec<serde_json::Value>,
    /// Full input strips (all inputs are visible from every bar for routing)
    inputs:   Vec<serde_json::Value>,
    /// Matrix slice: only the columns (outputs) belonging to this zone
    matrix:   Vec<Vec<f32>>,
}

/// GET /api/v1/zones/:zone_id — state scoped to one zone's outputs.
async fn get_zone_state(
    Path(zone_id): Path<String>,
    State(state):  State<SharedState>,
) -> impl IntoResponse {
    let output_indices = match state.config.zones.get(&zone_id) {
        Some(v) => v.clone(),
        None    => return StatusCode::NOT_FOUND.into_response(),
    };

    let params = state.params.read().await;
    let n_in   = params.inputs.len();

    // Build output slice
    let outputs: Vec<serde_json::Value> = output_indices.iter()
        .filter_map(|&o| params.outputs.get(o))
        .map(|b| serde_json::json!({
            "label": b.label,
            "mute":  b.mute,
            "master_gain": b.master_gain,
        }))
        .collect();

    // Build input strips
    let inputs: Vec<serde_json::Value> = (0..n_in)
        .filter_map(|i| params.inputs.get(i))
        .map(|s| serde_json::json!({
            "label": s.label,
            "mute":  s.mute,
            "solo":  s.solo,
            "gain_trim": s.gain_trim,
        }))
        .collect();

    // Build matrix slice — only zone columns
    let matrix: Vec<Vec<f32>> = (0..n_in)
        .map(|i| {
            output_indices.iter()
                .map(|&o| params.matrix.gains
                    .get(i)
                    .and_then(|row| row.get(o))
                    .copied()
                    .unwrap_or(0.0))
                .collect()
        })
        .collect();

    Json(ZoneState { zone_id, outputs, inputs, matrix }).into_response()
}
