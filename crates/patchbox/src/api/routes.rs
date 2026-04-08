use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use patchbox_core::{eq::EqParams, compressor::CompressorParams, scene};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;

use crate::api::{jwt, pam_auth};
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
        // D-05: EQ per input strip
        .route("/channels/input/:id/eq",        post(set_input_eq))
        // M-02: Pan/balance per input
        .route("/channels/input/:id/pan",        post(set_input_pan))
        // M-10: HPF per input
        .route("/channels/input/:id/hpf",        post(set_input_hpf))
        .route("/channels/output/:id/name",     post(set_output_name))
        .route("/channels/output/:id/mute",     post(toggle_output_mute))
        .route("/channels/output/:id/master_gain", post(set_output_master_gain))
        // D-06: Compressor per output bus
        .route("/channels/output/:id/compressor", post(set_output_compressor))
        // U-09: Channel reorder
        .route("/channels/input/reorder",  post(reorder_inputs))
        .route("/channels/output/reorder", post(reorder_outputs))
        .route("/scenes",           get(list_scenes).post(save_scene))
        .route("/scenes/:name",     get(get_scene).delete(delete_scene))
        .route("/scenes/:name/load", post(load_scene))
        // U-01: Zone-scoped view — returns state filtered to zone's outputs.
        .route("/zones",            get(list_zones))
        .route("/zones/:zone_id",   get(get_zone_state))
        // Z-02: Zone master volume + Z-04: Zone presets
        .route("/zones/:zone_id/master-gain",             post(set_zone_master_gain))
        .route("/zones/:zone_id/presets",                 get(list_zone_presets).post(save_zone_preset))
        .route("/zones/:zone_id/presets/:name/load",      post(load_zone_preset))
        .route("/zones/:zone_id/presets/:name",           axum::routing::delete(delete_zone_preset))
        // A-01: PAM.d login + JWT
        .route("/auth/login",  post(login))
        .route("/auth/whoami", get(whoami))
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
    use std::sync::atomic::Ordering;
    let params = state.params.read().await;
    let input_order  = state.input_order.read().await;
    let output_order = state.output_order.read().await;
    // R-13: Include current ETag so clients can use If-Match on subsequent mutations.
    let etag = state.etag();
    let mut headers = HeaderMap::new();
    headers.insert(axum::http::header::ETAG, etag.parse().unwrap());
    // D-04: Build per-channel Dante RX activity from bitmask
    let rx_mask = state.dante_rx_active.load(Ordering::Relaxed);
    let dante_rx_active: Vec<bool> = (0..params.inputs.len())
        .map(|i| (rx_mask >> i) & 1 == 1)
        .collect();
    // U-09: Include channel display order in state response.
    let body = serde_json::json!({
        "matrix":           params.matrix,
        "inputs":           params.inputs,
        "outputs":          params.outputs,
        "input_order":      *input_order,
        "output_order":     *output_order,
        "dante_rx_active":  dante_rx_active,
    });
    (headers, Json(body))
}

// ── Matrix cell ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GainBody {
    gain: f32,
}

async fn patch_matrix_cell(
    State(state): State<SharedState>,
    Path((input, output)): Path<(usize, usize)>,
    headers: HeaderMap,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    // R-13: Optimistic locking — if the client sends If-Match, reject stale writes.
    if let Some(if_match) = headers.get(axum::http::header::IF_MATCH) {
        let current = state.etag();
        if if_match.to_str().unwrap_or("") != current {
            return StatusCode::PRECONDITION_FAILED.into_response();
        }
    }

    let mut params = state.params.write().await;
    let n_in  = params.matrix.inputs;
    let n_out = params.matrix.outputs;
    if input >= n_in || output >= n_out {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    params.matrix.set(input, output, body.gain.clamp(0.0, 4.0));
    drop(params);
    // Bump version after mutation so subsequent GET /state returns a new ETag.
    let new_version = state.bump_version();
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert(axum::http::header::ETAG, format!("W/\"{}\"", new_version).parse().unwrap());
    (StatusCode::NO_CONTENT, resp_headers).into_response()
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
    drop(p);
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

async fn toggle_input_mute(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].mute = !p.inputs[id].mute;
    drop(p);
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

async fn toggle_input_solo(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].solo = !p.inputs[id].solo;
    drop(p);
    state.bump_version();
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
    drop(p);
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

async fn toggle_output_mute(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.outputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.outputs[id].mute = !p.outputs[id].mute;
    drop(p);
    state.bump_version();
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
    drop(p);
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

// M-02: Pan/balance per input channel
#[derive(Deserialize)]
struct PanBody { pan: f32 }

async fn set_input_pan(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(body): Json<PanBody>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].pan = body.pan.clamp(-1.0, 1.0);
    drop(p);
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

// M-10: HPF quick toggle per input channel
#[derive(Deserialize)]
struct HpfBody {
    enabled: bool,
    #[serde(default = "default_hpf_hz")]
    hz: f32,
}
fn default_hpf_hz() -> f32 { 80.0 }

async fn set_input_hpf(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(body): Json<HpfBody>,
) -> impl IntoResponse {
    let mut p = state.params.write().await;
    if id >= p.inputs.len() { return StatusCode::NOT_FOUND.into_response(); }
    p.inputs[id].hpf_enabled = body.enabled;
    p.inputs[id].hpf_hz      = body.hz.clamp(20.0, 2000.0);
    drop(p);
    state.bump_version();
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
    drop(p);
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

// ── Scenes ───────────────────────────────────────────────────────────────

async fn list_scenes(State(state): State<SharedState>) -> impl IntoResponse {
    let names = scene::list(&state.scenes_dir());
    Json(names)
}

/// U-06: Read scene data without applying it — used for diff view.
async fn get_scene(
    State(state): State<SharedState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    match scene::load(&state.scenes_dir(), &name) {
        Ok(s)  => Json(s).into_response(),
        Err(scene::SceneError::NotFound(_))    => StatusCode::NOT_FOUND.into_response(),
        Err(scene::SceneError::InvalidName(m)) => (StatusCode::BAD_REQUEST, m).into_response(),
        Err(e) => {
            tracing::error!("get_scene failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
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
        Ok(_)  => {
            state.bump_version();
            StatusCode::NO_CONTENT.into_response()
        }
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

// ── D-05: EQ per input strip ──────────────────────────────────────────────

/// POST /api/v1/channels/input/:id/eq — replace full EQ params for one input.
async fn set_input_eq(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(eq): Json<EqParams>,
) -> impl IntoResponse {
    let mut params = state.params.write().await;
    match params.inputs.get_mut(id) {
        Some(strip) => {
            strip.eq = eq;
            drop(params);
            state.bump_version();
            StatusCode::NO_CONTENT.into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// ── D-06: Compressor per output bus ──────────────────────────────────────

/// POST /api/v1/channels/output/:id/compressor — replace compressor params.
async fn set_output_compressor(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(comp): Json<CompressorParams>,
) -> impl IntoResponse {
    let mut params = state.params.write().await;
    match params.outputs.get_mut(id) {
        Some(bus) => {
            bus.compressor = comp;
            drop(params);
            state.bump_version();
            StatusCode::NO_CONTENT.into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// ── U-09: Channel reorder ────────────────────────────────────────────────

#[derive(Deserialize)]
struct ReorderBody {
    order: Vec<usize>,
}

/// POST /api/v1/channels/input/reorder — set display order for inputs.
/// `order` is a permutation of [0..N-1]. Validates that it is exactly that.
async fn reorder_inputs(
    State(state): State<SharedState>,
    Json(body): Json<ReorderBody>,
) -> impl IntoResponse {
    let n = state.params.read().await.inputs.len();
    if !is_valid_permutation(&body.order, n) {
        return (StatusCode::BAD_REQUEST, "order must be a permutation of [0..N-1]").into_response();
    }
    let mut order = state.input_order.write().await;
    *order = body.order;
    StatusCode::NO_CONTENT.into_response()
}

/// POST /api/v1/channels/output/reorder — set display order for outputs.
async fn reorder_outputs(
    State(state): State<SharedState>,
    Json(body): Json<ReorderBody>,
) -> impl IntoResponse {
    let n = state.params.read().await.outputs.len();
    if !is_valid_permutation(&body.order, n) {
        return (StatusCode::BAD_REQUEST, "order must be a permutation of [0..N-1]").into_response();
    }
    let mut order = state.output_order.write().await;
    *order = body.order;
    StatusCode::NO_CONTENT.into_response()
}

fn is_valid_permutation(order: &[usize], n: usize) -> bool {
    if order.len() != n { return false; }
    let mut seen = vec![false; n];
    for &i in order {
        if i >= n || seen[i] { return false; }
        seen[i] = true;
    }
    true
}

// ── Z-02: Zone master gain ────────────────────────────────────────────────

#[derive(Deserialize)]
struct ZoneMasterGainBody { gain: f32 }

/// POST /api/v1/zones/:zone_id/master-gain — set master_gain for all outputs in the zone.
async fn set_zone_master_gain(
    Path(zone_id): Path<String>,
    State(state):  State<SharedState>,
    Json(body):    Json<ZoneMasterGainBody>,
) -> impl IntoResponse {
    let output_indices = match state.config.zones.get(&zone_id) {
        Some(v) => v.clone(),
        None    => return StatusCode::NOT_FOUND.into_response(),
    };
    let gain = body.gain.clamp(0.0, 4.0);
    let mut params = state.params.write().await;
    for &o in &output_indices {
        if let Some(bus) = params.outputs.get_mut(o) {
            bus.master_gain = gain;
        }
    }
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

// ── Z-04: Zone presets ────────────────────────────────────────────────────

/// Zone preset: a snapshot of the matrix columns + output gains for a zone.
#[derive(Serialize, Deserialize, Clone)]
struct ZonePreset {
    zone_id:        String,
    name:           String,
    output_indices: Vec<usize>,
    /// master_gain per zone output (same order as output_indices)
    output_gains:   Vec<f32>,
    /// matrix[input][zone_col] — gains for each zone output column
    matrix:         Vec<Vec<f32>>,
}

fn zone_presets_dir(state: &SharedState, zone_id: &str) -> std::path::PathBuf {
    state.scenes_dir().join(format!("zone-{}", zone_id))
}

fn preset_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ')
}

fn preset_filename(name: &str) -> String {
    format!("{}.json", name.replace(' ', "_"))
}

/// GET /api/v1/zones/:zone_id/presets — list saved zone presets.
async fn list_zone_presets(
    Path(zone_id): Path<String>,
    State(state):  State<SharedState>,
) -> impl IntoResponse {
    if !state.config.zones.contains_key(&zone_id) {
        return (StatusCode::NOT_FOUND, Json(Vec::<String>::new())).into_response();
    }
    let dir = zone_presets_dir(&state, &zone_id);
    let names: Vec<String> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| {
                let e = e.ok()?;
                let fname = e.file_name().into_string().ok()?;
                fname.strip_suffix(".json").map(|s| s.replace('_', " "))
            })
            .collect()
        })
        .unwrap_or_default();
    Json(names).into_response()
}

#[derive(Deserialize)]
struct SaveZonePresetBody { name: String }

/// POST /api/v1/zones/:zone_id/presets — save current zone state as a named preset.
async fn save_zone_preset(
    Path(zone_id): Path<String>,
    State(state):  State<SharedState>,
    Json(body):    Json<SaveZonePresetBody>,
) -> impl IntoResponse {
    let output_indices = match state.config.zones.get(&zone_id) {
        Some(v) => v.clone(),
        None    => return (StatusCode::NOT_FOUND, "zone not found").into_response(),
    };
    if !preset_name_valid(&body.name) {
        return (StatusCode::BAD_REQUEST, "invalid preset name").into_response();
    }
    let params = state.params.read().await;
    let n_in = params.inputs.len();
    let output_gains: Vec<f32> = output_indices.iter()
        .filter_map(|&o| params.outputs.get(o).map(|b| b.master_gain))
        .collect();
    let matrix: Vec<Vec<f32>> = (0..n_in).map(|i| {
        output_indices.iter()
            .map(|&o| params.matrix.gains.get(i).and_then(|r| r.get(o)).copied().unwrap_or(0.0))
            .collect()
    }).collect();
    let preset = ZonePreset { zone_id: zone_id.clone(), name: body.name.clone(), output_indices, output_gains, matrix };
    drop(params);

    let dir = zone_presets_dir(&state, &zone_id);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    let path = dir.join(preset_filename(&body.name));
    let json = serde_json::to_string_pretty(&preset).unwrap();
    if let Err(e) = std::fs::write(&path, json) {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

/// POST /api/v1/zones/:zone_id/presets/:name/load — restore a zone preset.
async fn load_zone_preset(
    Path((zone_id, name)): Path<(String, String)>,
    State(state):          State<SharedState>,
) -> impl IntoResponse {
    if !state.config.zones.contains_key(&zone_id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let dir   = zone_presets_dir(&state, &zone_id);
    let path  = dir.join(preset_filename(&name));
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let preset: ZonePreset = match serde_json::from_slice(&bytes) {
        Ok(p) => p,
        Err(_) => return StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    };
    let mut params = state.params.write().await;
    // Restore matrix columns
    for (col, &o) in preset.output_indices.iter().enumerate() {
        for (i, row) in preset.matrix.iter().enumerate() {
            if let Some(cell) = params.matrix.gains.get_mut(i).and_then(|r| r.get_mut(o)) {
                *cell = row.get(col).copied().unwrap_or(0.0);
            }
        }
        // Restore output gains
        if let (Some(gain), Some(bus)) = (preset.output_gains.get(col), params.outputs.get_mut(o)) {
            bus.master_gain = *gain;
        }
    }
    state.bump_version();
    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/v1/zones/:zone_id/presets/:name — delete a zone preset.
async fn delete_zone_preset(
    Path((zone_id, name)): Path<(String, String)>,
    State(state):          State<SharedState>,
) -> impl IntoResponse {
    if !state.config.zones.contains_key(&zone_id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = zone_presets_dir(&state, &zone_id).join(preset_filename(&name));
    match std::fs::remove_file(&path) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// suppress unused import warning when zones map is empty
fn _use_hashmap(_: HashMap<String, String>) {}

// ── A-01: PAM.d Login + JWT ───────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token:    String,
    role:     String,
    #[serde(skip_serializing_if = "Option::is_none")]
    zone:     Option<String>,
    username: String,
}

/// POST /api/v1/auth/login — authenticate via PAM, return JWT.
/// Rate-limited upstream to 5 req/min per IP (see mod.rs governor config).
async fn login(
    State(state): State<SharedState>,
    Json(body):   Json<LoginBody>,
) -> impl IntoResponse {
    // Basic input validation
    if body.username.is_empty() || body.password.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"missing credentials"}))).into_response();
    }
    if body.username.len() > 64 || body.password.len() > 256 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"input too long"}))).into_response();
    }

    // PAM service: use "patchbox" if /etc/pam.d/patchbox exists, else fall back to "login"
    let service = if std::path::Path::new("/etc/pam.d/patchbox").exists() {
        "patchbox"
    } else {
        "login"
    };

    match pam_auth::authenticate(service, &body.username, &body.password).await {
        Ok(()) => {
            let (role, zone) = pam_auth::role_for_user(&body.username);
            let claims = jwt::Claims::new(&body.username, role, zone.clone());
            match jwt::generate(&claims, &state.jwt_secret) {
                Ok(token) => Json(LoginResponse {
                    token,
                    role:     role.to_owned(),
                    zone,
                    username: body.username,
                }).into_response(),
                Err(e) => {
                    tracing::error!("JWT generation failed: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Err(pam_auth::PamError::AuthFailed) | Err(pam_auth::PamError::UserUnknown) => {
            // Constant-time delay to prevent timing attacks
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"invalid credentials"}))).into_response()
        }
        Err(e) => {
            tracing::warn!("PAM error for user {}: {}", body.username, e);
            (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error":"auth service unavailable"}))).into_response()
        }
    }
}

/// GET /api/v1/auth/whoami — decode JWT from Authorization header and return claims.
async fn whoami(
    State(state): State<SharedState>,
    headers:      HeaderMap,
) -> impl IntoResponse {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "));

    match token {
        Some(t) => match jwt::validate(t, &state.jwt_secret) {
            Ok(claims) => Json(serde_json::json!({
                "username": claims.sub,
                "role":     claims.role,
                "zone":     claims.zone,
                "exp":      claims.exp,
            })).into_response(),
            Err(_) => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"invalid token"}))).into_response(),
        },
        None => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"no token"}))).into_response(),
    }
}
