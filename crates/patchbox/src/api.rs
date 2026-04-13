use axum::{
    middleware,
    extract::{Path, State, WebSocketUpgrade, ws::{WebSocket, Message}},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, put, post, delete},
    Json, Router,
};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};

#[derive(RustEmbed)]
#[folder = "../../web/src/"]
struct Assets;

/// Serve a file embedded at compile-time from web/src/
fn serve_asset(path: &str) -> Response {
    match Assets::get(path) {
        Some(content) => {
            let mime = match path.rsplit('.').next() {
                Some("css")  => "text/css; charset=utf-8",
                Some("js")   => "application/javascript; charset=utf-8",
                Some("html") => "text/html; charset=utf-8",
                _            => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, mime)], content.data.into_owned()).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
use crate::state::AppState;
use crate::auth_api;
use crate::scenes::Scene;
use std::time::Duration;
use tokio::time::interval;

#[derive(Deserialize)]
pub struct MatrixUpdate { pub tx: usize, pub rx: usize, pub enabled: bool }

#[derive(Deserialize)]
pub struct GainUpdate { pub channel: usize, pub db: f32 }

#[derive(Deserialize)]
pub struct NameUpdate { pub name: String }

#[derive(Deserialize)]
pub struct SaveSceneRequest { pub name: String, pub description: Option<String> }

#[derive(Deserialize)]
pub struct EqUpdate { pub band: usize, pub freq_hz: f32, pub gain_db: f32, pub q: f32 }

#[derive(Deserialize)]
pub struct EqEnabledUpdate { pub enabled: bool }

#[derive(Deserialize)]
pub struct LimiterUpdate { pub threshold_db: f32, pub attack_ms: f32, pub release_ms: f32 }

#[derive(Deserialize)]
pub struct LimiterEnabledUpdate { pub enabled: bool }

use std::sync::atomic::Ordering as AOrdering;

#[derive(Serialize)]
pub struct HealthDante { pub name: String, pub nic: String, pub connected: bool }

#[derive(Serialize)]
pub struct HealthPtp { pub synced: bool, pub socket_path: String }

#[derive(Serialize)]
pub struct HealthAudio {
    pub rx_channels: usize,
    pub tx_channels: usize,
    pub active_routes: usize,
    pub callbacks_total: u64,
    pub resyncs: u64,
    pub rx_levels_rms_db: Vec<f32>,
    pub tx_levels_rms_db: Vec<f32>,
}

#[derive(Serialize)]
pub struct HealthZone {
    pub name: String,
    pub index: usize,
    pub muted: bool,
    pub gain_db: f32,
    pub eq_enabled: bool,
    pub limiter_enabled: bool,
    pub active_sources: Vec<String>,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub uptime_secs: u64,
    pub dante: HealthDante,
    pub ptp: HealthPtp,
    pub audio: HealthAudio,
    pub zones: Vec<HealthZone>,
}

/// Convert linear amplitude to dBFS, floor at -60 dB.
fn linear_to_db(v: f32) -> f32 {
    if v <= 0.0 { return -60.0; }
    (20.0 * v.log10()).max(-60.0)
}

// GET /api/v1/health
async fn get_health(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let meters = s.meters.read().await;

    // PTP: try connecting to the statime Unix socket with a 200ms timeout
    let ptp_synced = {
        let path = cfg.dante_clock_path.clone();
        tokio::time::timeout(
            Duration::from_millis(200),
            tokio::net::UnixStream::connect(&path),
        )
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
    };

    // Audio stats
    let active_routes = cfg.matrix.iter().flatten().filter(|&&v| v).count();
    let rx_levels_rms_db = meters.rx_rms.iter().map(|&v| linear_to_db(v)).collect();
    let tx_levels_rms_db = meters.tx_rms.iter().map(|&v| linear_to_db(v)).collect();

    // Per-zone status with active source names
    let zones = (0..cfg.tx_channels).map(|tx| {
        let active_sources = (0..cfg.rx_channels)
            .filter(|&rx| cfg.matrix.get(tx).and_then(|row| row.get(rx)).copied().unwrap_or(false))
            .map(|rx| cfg.sources.get(rx).cloned().unwrap_or_else(|| format!("Source {rx}")))
            .collect();
        HealthZone {
            name: cfg.zones.get(tx).cloned().unwrap_or_else(|| format!("Zone {tx}")),
            index: tx,
            muted: cfg.output_muted.get(tx).copied().unwrap_or(false),
            gain_db: cfg.output_gain_db.get(tx).copied().unwrap_or(0.0),
            eq_enabled: cfg.per_output_eq.get(tx).map(|e| e.enabled).unwrap_or(false),
            limiter_enabled: cfg.per_output_limiter.get(tx).map(|l| l.enabled).unwrap_or(false),
            active_sources,
        }
    }).collect();

    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        uptime_secs: s.started_at.elapsed().as_secs(),
        dante: HealthDante {
            name: cfg.dante_name.clone(),
            nic: cfg.dante_nic.clone(),
            connected: s.dante_connected.load(AOrdering::Relaxed),
        },
        ptp: HealthPtp {
            synced: ptp_synced,
            socket_path: cfg.dante_clock_path.clone(),
        },
        audio: HealthAudio {
            rx_channels: cfg.rx_channels,
            tx_channels: cfg.tx_channels,
            active_routes,
            callbacks_total: s.audio_callbacks.load(AOrdering::Relaxed),
            resyncs: s.resyncs.load(AOrdering::Relaxed),
            rx_levels_rms_db,
            tx_levels_rms_db,
        },
        zones,
    })
}

async fn put_matrix(State(s): State<AppState>, Json(u): Json<MatrixUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if u.tx >= cfg.tx_channels || u.rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "out of range").into_response();
    }
    cfg.matrix[u.tx][u.rx] = u.enabled;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// PUT /api/v1/gain/input
async fn put_gain_input(State(s): State<AppState>, Json(u): Json<GainUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if u.channel >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "out of range").into_response();
    }
    cfg.input_gain_db[u.channel] = u.db.clamp(-60.0, 12.0);
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// PUT /api/v1/gain/output
async fn put_gain_output(State(s): State<AppState>, Json(u): Json<GainUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if u.channel >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "out of range").into_response();
    }
    cfg.output_gain_db[u.channel] = u.db.clamp(-60.0, 12.0);
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// POST /api/v1/zones/:tx/mute
async fn mute_zone(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "zone out of range").into_response();
    }
    cfg.output_muted[tx] = true;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// POST /api/v1/zones/:tx/unmute
async fn unmute_zone(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "zone out of range").into_response();
    }
    cfg.output_muted[tx] = false;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// POST /api/v1/mute-all — panic button: silence all zones
async fn mute_all(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() { *m = true; }
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// POST /api/v1/unmute-all — restore all zones
async fn unmute_all(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() { *m = false; }
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

#[derive(Serialize)]
pub struct MeterFrame {
    pub tx_rms: Vec<f32>,
    pub rx_rms: Vec<f32>,
    pub tx_peak: Vec<f32>,
    pub rx_peak: Vec<f32>,
    pub tx_gr_db: Vec<f32>,
    pub rx_gr_db: Vec<f32>,
    pub rx_gate_open: Vec<bool>,
}

// GET /api/v1/config
async fn get_config(State(s): State<AppState>) -> impl IntoResponse {
    Json(s.config.read().await.clone())
}

// PUT /api/v1/matrix
async fn list_scenes(State(s): State<AppState>) -> impl IntoResponse {
    let store = s.scenes.read().await;
    let list: Vec<&Scene> = store.scenes.values().collect();
    Json(serde_json::json!({ "scenes": list, "active": store.active }))
}

// POST /api/v1/scenes — save current state as scene
async fn save_scene(State(s): State<AppState>, Json(req): Json<SaveSceneRequest>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let scene = Scene::from_config(&req.name, &cfg, req.description);
    drop(cfg);
    let mut store = s.scenes.write().await;
    store.scenes.insert(req.name.clone(), scene);
    drop(store);
    let _ = s.persist_scenes().await;
    StatusCode::OK.into_response()
}

// POST /api/v1/scenes/:name/load — apply a scene
async fn load_scene(State(s): State<AppState>, Path(name): Path<String>) -> impl IntoResponse {
    let store = s.scenes.read().await;
    let scene = match store.scenes.get(&name) {
        Some(sc) => sc.clone(),
        None => return (StatusCode::NOT_FOUND, "scene not found").into_response(),
    };
    drop(store);
    let mut cfg = s.config.write().await;
    scene.apply_to_config(&mut cfg);
    drop(cfg);
    s.scenes.write().await.active = Some(name);
    let _ = s.persist().await;
    let _ = s.persist_scenes().await;
    StatusCode::OK.into_response()
}

// DELETE /api/v1/scenes/:name
async fn delete_scene(State(s): State<AppState>, Path(name): Path<String>) -> impl IntoResponse {
    let mut store = s.scenes.write().await;
    if store.scenes.remove(&name).is_none() {
        return (StatusCode::NOT_FOUND, "scene not found").into_response();
    }
    drop(store);
    let _ = s.persist_scenes().await;
    StatusCode::OK.into_response()
}

// PUT /api/v1/sources/:idx/name
async fn put_source_name(State(s): State<AppState>, Path(idx): Path<usize>, Json(u): Json<NameUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if idx >= cfg.sources.len() {
        return (StatusCode::BAD_REQUEST, "index out of range").into_response();
    }
    cfg.sources[idx] = u.name;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// PUT /api/v1/zones/:idx/name
async fn put_zone_name(State(s): State<AppState>, Path(idx): Path<usize>, Json(u): Json<NameUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if idx >= cfg.zones.len() {
        return (StatusCode::BAD_REQUEST, "index out of range").into_response();
    }
    cfg.zones[idx] = u.name;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

// GET /api/v1/zones/:tx/eq
async fn get_eq(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.per_output_eq.get(tx) {
        Some(eq) => Json(eq.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/zones/:tx/eq
async fn put_eq(State(s): State<AppState>, Path(tx): Path<usize>, Json(u): Json<EqUpdate>) -> impl IntoResponse {
    if u.band >= 3 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut cfg = s.config.write().await;
    let Some(eq) = cfg.per_output_eq.get_mut(tx) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    eq.bands[u.band].freq_hz = u.freq_hz.clamp(20.0, 20_000.0);
    eq.bands[u.band].gain_db = u.gain_db.clamp(-24.0, 24.0);
    eq.bands[u.band].q = u.q.clamp(0.1, 10.0);
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/zones/:tx/eq/enabled
async fn put_eq_enabled(State(s): State<AppState>, Path(tx): Path<usize>, Json(u): Json<EqEnabledUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(eq) = cfg.per_output_eq.get_mut(tx) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    eq.enabled = u.enabled;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/zones/:tx/limiter
async fn get_limiter(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.per_output_limiter.get(tx) {
        Some(lim) => Json(lim.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/zones/:tx/limiter
async fn put_limiter(State(s): State<AppState>, Path(tx): Path<usize>, Json(u): Json<LimiterUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(lim) = cfg.per_output_limiter.get_mut(tx) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    lim.threshold_db = u.threshold_db.clamp(-40.0, 0.0);
    lim.attack_ms = u.attack_ms.clamp(0.1, 50.0);
    lim.release_ms = u.release_ms.clamp(10.0, 2000.0);
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/zones/:tx/limiter/enabled
async fn put_limiter_enabled(State(s): State<AppState>, Path(tx): Path<usize>, Json(u): Json<LimiterEnabledUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(lim) = cfg.per_output_limiter.get_mut(tx) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    lim.enabled = u.enabled;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

use patchbox_core::config::{
    PatchboxConfig,
    ZoneConfig,
    InputChannelDsp, OutputChannelDsp,
    FilterConfig, EqConfig, GateConfig, CompressorConfig, LimiterConfig, DelayConfig,
};

use std::collections::HashMap;
use axum::extract::Query;

#[derive(Deserialize)] struct GainBody { gain_db: f32 }
#[derive(Deserialize)] struct EnabledBody { enabled: bool }
#[derive(Deserialize)] struct MutedBody { muted: bool }
#[derive(Deserialize)] struct PolarityBody { invert: bool }

// ---------------------------------------------------------------------------
// Input DSP handlers
// ---------------------------------------------------------------------------

// GET /api/v1/inputs/:ch/dsp
async fn get_input_dsp(State(s): State<AppState>, Path(ch): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.input_dsp.get(ch) {
        Some(dsp) => Json(dsp.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/inputs/:ch/gain
async fn put_input_gain(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<GainBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.gain_db = body.gain_db.clamp(-60.0, 24.0);
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/polarity
async fn put_input_polarity(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<PolarityBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.polarity = body.invert;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/hpf
async fn put_input_hpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.hpf = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/lpf
async fn put_input_lpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.lpf = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/eq
async fn put_input_eq(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EqConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/eq/enabled
async fn put_input_eq_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq.enabled = body.enabled;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/gate
async fn put_input_gate(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<GateConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.gate = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/compressor
async fn put_input_compressor(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<CompressorConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.compressor = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/enabled
async fn put_input_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.enabled = body.enabled;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// ---------------------------------------------------------------------------
// Output DSP handlers
// ---------------------------------------------------------------------------

// GET /api/v1/outputs/:ch/dsp
async fn get_output_dsp(State(s): State<AppState>, Path(ch): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.output_dsp.get(ch) {
        Some(dsp) => Json(dsp.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/outputs/:ch/gain
async fn put_output_gain(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<GainBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.gain_db = body.gain_db.clamp(-60.0, 24.0);
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/hpf
async fn put_output_hpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.hpf = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/lpf
async fn put_output_lpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.lpf = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq
async fn put_output_eq(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EqConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq/enabled
async fn put_output_eq_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq.enabled = body.enabled;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/compressor
async fn put_output_compressor(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<CompressorConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.compressor = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/limiter
async fn put_output_limiter(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<LimiterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.limiter = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/delay
async fn put_output_delay(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<DelayConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.delay = body;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/enabled
async fn put_output_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.enabled = body.enabled;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/mute — alias: set muted state directly
async fn put_output_mute(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<MutedBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.muted = body.muted;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// ===========================================================================
// Sprint 1 — Resource endpoints (channels, outputs, zones, routes, metering,
//             system, system config, scene gaps)
// ===========================================================================

// --- Helpers ---

fn parse_rx_id(id: &str) -> Option<usize> {
    id.strip_prefix("rx_")?.parse().ok()
}

fn parse_tx_id(id: &str) -> Option<usize> {
    id.strip_prefix("tx_")?.parse().ok()
}

fn parse_zone_id(id: &str) -> Option<usize> {
    id.strip_prefix("zone_")?.parse().ok()
}

fn get_hostname() -> String {
    std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn input_dsp_to_value(dsp: &InputChannelDsp) -> serde_json::Value {
    serde_json::json!({
        "flt": {
            "enabled": dsp.hpf.enabled || dsp.lpf.enabled,
            "bypassed": false,
            "params": {"hpf": {"enabled": dsp.hpf.enabled, "freq_hz": dsp.hpf.freq_hz}, "lpf": {"enabled": dsp.lpf.enabled, "freq_hz": dsp.lpf.freq_hz}}
        },
        "peq": {"enabled": dsp.eq.enabled, "bypassed": false, "params": &dsp.eq},
        "gte": {"enabled": dsp.gate.enabled, "bypassed": false, "params": &dsp.gate},
        "cmp": {"enabled": dsp.compressor.enabled, "bypassed": false, "params": &dsp.compressor},
    })
}

fn output_dsp_to_value(dsp: &OutputChannelDsp) -> serde_json::Value {
    serde_json::json!({
        "flt": {
            "enabled": dsp.hpf.enabled || dsp.lpf.enabled,
            "bypassed": false,
            "params": {"hpf": {"enabled": dsp.hpf.enabled, "freq_hz": dsp.hpf.freq_hz}, "lpf": {"enabled": dsp.lpf.enabled, "freq_hz": dsp.lpf.freq_hz}}
        },
        "peq": {"enabled": dsp.eq.enabled, "bypassed": false, "params": &dsp.eq},
        "cmp": {"enabled": dsp.compressor.enabled, "bypassed": false, "params": &dsp.compressor},
        "lim": {"enabled": dsp.limiter.enabled, "bypassed": false, "params": &dsp.limiter},
        "dly": {"enabled": dsp.delay.enabled, "bypassed": false, "params": &dsp.delay},
    })
}

fn linear_to_dbfs(v: f32) -> f32 {
    if v <= 0.0 { return -60.0; }
    (20.0 * v.log10()).max(-60.0)
}

// --- Response types ---

#[derive(Serialize)]
struct ChannelResponse {
    id: String,
    name: String,
    source_type: &'static str,
    gain_db: f32,
    enabled: bool,
    dsp: serde_json::Value,
}

#[derive(Serialize)]
struct OutputResponse {
    id: String,
    name: String,
    zone_id: String,
    zone_colour_index: u8,
    volume_db: f32,
    muted: bool,
    polarity: bool,
    dsp: serde_json::Value,
}

#[derive(Serialize)]
struct RouteResponse {
    id: String,
    rx_id: String,
    tx_id: String,
    route_type: &'static str,
}

#[derive(Serialize)]
struct MeteringResponse {
    rx: HashMap<String, f32>,
    tx: HashMap<String, f32>,
    gr: HashMap<String, f32>,
}

#[derive(Serialize)]
struct SystemResponse {
    version: &'static str,
    hostname: String,
    uptime_s: u64,
    sample_rate: u32,
    rx_count: usize,
    tx_count: usize,
    zone_count: usize,
    dante_status: String,
    ptp_locked: bool,
    audio_drops: u64,
}

// --- Request types ---

#[derive(Deserialize)]
struct UpdateChannelRequest {
    name: Option<String>,
    gain_db: Option<f32>,
    enabled: Option<bool>,
}

#[derive(Deserialize)]
struct UpdateOutputRequest {
    name: Option<String>,
    volume_db: Option<f32>,
    muted: Option<bool>,
}

#[derive(Deserialize)]
struct CreateZoneRequest {
    name: String,
    colour_index: Option<u8>,
    tx_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct UpdateZoneRequest {
    name: Option<String>,
    colour_index: Option<u8>,
    tx_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct CreateRouteRequest {
    rx_id: String,
    tx_id: String,
}

#[derive(Deserialize)]
struct UpdateSceneRequest {
    name: Option<String>,
    description: Option<String>,
    is_favourite: Option<bool>,
}

// --- Channel endpoints ---

// GET /api/v1/channels
async fn get_channels(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let channels: Vec<ChannelResponse> = (0..cfg.rx_channels)
        .map(|i| {
            let name = cfg.sources.get(i).cloned().unwrap_or_else(|| format!("Source {}", i + 1));
            let dsp = cfg.input_dsp.get(i).cloned().unwrap_or_default();
            ChannelResponse {
                id: format!("rx_{}", i),
                name,
                source_type: "dante",
                gain_db: dsp.gain_db,
                enabled: dsp.enabled,
                dsp: input_dsp_to_value(&dsp),
            }
        })
        .collect();
    Json(channels)
}

// GET /api/v1/channels/:id
async fn get_channel(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(i) = parse_rx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid channel id").into_response();
    };
    let cfg = s.config.read().await;
    if i >= cfg.rx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    let name = cfg.sources.get(i).cloned().unwrap_or_else(|| format!("Source {}", i + 1));
    let dsp = cfg.input_dsp.get(i).cloned().unwrap_or_default();
    Json(ChannelResponse {
        id: format!("rx_{}", i),
        name,
        source_type: "dante",
        gain_db: dsp.gain_db,
        enabled: dsp.enabled,
        dsp: input_dsp_to_value(&dsp),
    }).into_response()
}

// PUT /api/v1/channels/:id
async fn put_channel(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<UpdateChannelRequest>) -> impl IntoResponse {
    let Some(i) = parse_rx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid channel id").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.rx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(name) = body.name {
        if i < cfg.sources.len() { cfg.sources[i] = name; }
    }
    if let Some(gain) = body.gain_db {
        if i < cfg.input_dsp.len() { cfg.input_dsp[i].gain_db = gain.clamp(-60.0, 24.0); }
    }
    if let Some(enabled) = body.enabled {
        if i < cfg.input_dsp.len() { cfg.input_dsp[i].enabled = enabled; }
    }
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// --- Output resource endpoints ---

// GET /api/v1/outputs
async fn get_outputs(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let outputs: Vec<OutputResponse> = (0..cfg.tx_channels)
        .map(|i| {
            let name = cfg.zone_config.get(i)
                .map(|z| z.name.clone())
                .unwrap_or_else(|| cfg.zones.get(i).cloned().unwrap_or_else(|| format!("Zone {}", i + 1)));
            let zone_id = cfg.zone_config.get(i)
                .map(|z| z.id.clone())
                .unwrap_or_else(|| format!("zone_{}", i));
            let zone_colour_index = cfg.zone_config.get(i)
                .map(|z| z.colour_index)
                .unwrap_or((i % 10) as u8);
            let dsp = cfg.output_dsp.get(i).cloned().unwrap_or_default();
            OutputResponse {
                id: format!("tx_{}", i),
                name,
                zone_id,
                zone_colour_index,
                volume_db: dsp.gain_db,
                muted: dsp.muted,
                polarity: dsp.polarity,
                dsp: output_dsp_to_value(&dsp),
            }
        })
        .collect();
    Json(outputs)
}

// GET /api/v1/outputs/:id  — single output by "tx_N" string id
async fn get_output_resource(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(i) = parse_tx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid output id (expected tx_N)").into_response();
    };
    let cfg = s.config.read().await;
    if i >= cfg.tx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    let name = cfg.zone_config.get(i)
        .map(|z| z.name.clone())
        .unwrap_or_else(|| cfg.zones.get(i).cloned().unwrap_or_else(|| format!("Zone {}", i + 1)));
    let zone_id = cfg.zone_config.get(i)
        .map(|z| z.id.clone())
        .unwrap_or_else(|| format!("zone_{}", i));
    let zone_colour_index = cfg.zone_config.get(i)
        .map(|z| z.colour_index)
        .unwrap_or((i % 10) as u8);
    let dsp = cfg.output_dsp.get(i).cloned().unwrap_or_default();
    Json(OutputResponse {
        id: format!("tx_{}", i),
        name,
        zone_id,
        zone_colour_index,
        volume_db: dsp.gain_db,
        muted: dsp.muted,
        polarity: dsp.polarity,
        dsp: output_dsp_to_value(&dsp),
    }).into_response()
}

// PUT /api/v1/outputs/:id — update output by "tx_N" string id
async fn put_output_resource(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<UpdateOutputRequest>) -> impl IntoResponse {
    let Some(i) = parse_tx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid output id (expected tx_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.tx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(ref name) = body.name {
        if i < cfg.zones.len() { cfg.zones[i] = name.clone(); }
        if i < cfg.zone_config.len() { cfg.zone_config[i].name = name.clone(); }
    }
    if let Some(vol) = body.volume_db {
        if i < cfg.output_dsp.len() { cfg.output_dsp[i].gain_db = vol.clamp(-60.0, 24.0); }
    }
    if let Some(muted) = body.muted {
        if i < cfg.output_dsp.len() { cfg.output_dsp[i].muted = muted; }
        if i < cfg.output_muted.len() { cfg.output_muted[i] = muted; }
    }
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// --- Zone CRUD ---

// GET /api/v1/zones  (resource list — at path depth 1; existing zone sub-routes at depth 2+ don't conflict)
async fn get_zones_list(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(cfg.zone_config.clone())
}

// POST /api/v1/zones
async fn post_zone(State(s): State<AppState>, Json(body): Json<CreateZoneRequest>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let idx = cfg.zone_config.len();
    let zone = ZoneConfig {
        id: format!("zone_{}", idx),
        name: body.name,
        colour_index: body.colour_index.unwrap_or((idx % 10) as u8),
        tx_ids: body.tx_ids.unwrap_or_default(),
    };
    cfg.zone_config.push(zone.clone());
    drop(cfg);
    let _ = s.persist().await;
    (StatusCode::CREATED, Json(zone)).into_response()
}

// PUT /api/v1/zones/:zone_id  — update zone by string id "zone_N"
// Note: existing routes are /zones/:tx/mute etc. (depth 2); this is depth 1 — no conflict
async fn put_zone_resource(State(s): State<AppState>, Path(zone_id): Path<String>, Json(body): Json<UpdateZoneRequest>) -> impl IntoResponse {
    let Some(i) = parse_zone_id(&zone_id) else {
        return (StatusCode::BAD_REQUEST, "invalid zone id (expected zone_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.zone_config.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(name) = body.name {
        if i < cfg.zones.len() { cfg.zones[i] = name.clone(); }
        cfg.zone_config[i].name = name;
    }
    if let Some(ci) = body.colour_index {
        cfg.zone_config[i].colour_index = ci;
    }
    if let Some(tx_ids) = body.tx_ids {
        cfg.zone_config[i].tx_ids = tx_ids;
    }
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/zones/:zone_id — delete zone by string id "zone_N"
async fn delete_zone_resource(State(s): State<AppState>, Path(zone_id): Path<String>) -> impl IntoResponse {
    let Some(i) = parse_zone_id(&zone_id) else {
        return (StatusCode::BAD_REQUEST, "invalid zone id (expected zone_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.zone_config.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    cfg.zone_config.remove(i);
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// --- Route resource endpoints ---

// GET /api/v1/routes
async fn get_routes(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let mut routes = Vec::new();
    for (tx, row) in cfg.matrix.iter().enumerate() {
        for (rx, &enabled) in row.iter().enumerate() {
            if enabled {
                routes.push(RouteResponse {
                    id: format!("rx_{}|tx_{}", rx, tx),
                    rx_id: format!("rx_{}", rx),
                    tx_id: format!("tx_{}", tx),
                    route_type: "dante",
                });
            }
        }
    }
    Json(routes)
}

// POST /api/v1/routes
async fn post_route(State(s): State<AppState>, Json(body): Json<CreateRouteRequest>) -> impl IntoResponse {
    let Some(rx) = parse_rx_id(&body.rx_id) else {
        return (StatusCode::BAD_REQUEST, "invalid rx_id").into_response();
    };
    let Some(tx) = parse_tx_id(&body.tx_id) else {
        return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response();
    };
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels || rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "channel index out of range").into_response();
    }
    cfg.matrix[tx][rx] = true;
    drop(cfg);
    let _ = s.persist().await;
    let route_id = format!("rx_{}|tx_{}", rx, tx);
    (StatusCode::CREATED, Json(serde_json::json!({"id": route_id, "rx_id": body.rx_id, "tx_id": body.tx_id}))).into_response()
}

// DELETE /api/v1/routes/:id — id is "rx_N|tx_M" (| may be URL-encoded as %7C)
async fn delete_route(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let parts: Vec<&str> = id.splitn(2, '|').collect();
    if parts.len() != 2 {
        return (StatusCode::BAD_REQUEST, "invalid route id — expected rx_N|tx_M").into_response();
    }
    let Some(rx) = parse_rx_id(parts[0]) else {
        return (StatusCode::BAD_REQUEST, "invalid rx part in route id").into_response();
    };
    let Some(tx) = parse_tx_id(parts[1]) else {
        return (StatusCode::BAD_REQUEST, "invalid tx part in route id").into_response();
    };
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels || rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "channel index out of range").into_response();
    }
    cfg.matrix[tx][rx] = false;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/routes?rx_id=...&tx_id=... — bulk delete by query params
async fn delete_routes_bulk(State(s): State<AppState>, Query(params): Query<HashMap<String, String>>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    match (params.get("rx_id"), params.get("tx_id")) {
        (Some(rx_id), Some(tx_id)) => {
            let Some(rx) = parse_rx_id(rx_id) else { return (StatusCode::BAD_REQUEST, "invalid rx_id").into_response(); };
            let Some(tx) = parse_tx_id(tx_id) else { return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response(); };
            if tx < cfg.tx_channels && rx < cfg.rx_channels {
                cfg.matrix[tx][rx] = false;
            }
        }
        (Some(rx_id), None) => {
            let Some(rx) = parse_rx_id(rx_id) else { return (StatusCode::BAD_REQUEST, "invalid rx_id").into_response(); };
            for row in cfg.matrix.iter_mut() {
                if rx < row.len() { row[rx] = false; }
            }
        }
        (None, Some(tx_id)) => {
            let Some(tx) = parse_tx_id(tx_id) else { return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response(); };
            if let Some(row) = cfg.matrix.get_mut(tx) {
                for cell in row.iter_mut() { *cell = false; }
            }
        }
        (None, None) => {
            return (StatusCode::BAD_REQUEST, "specify rx_id, tx_id, or both as query params").into_response();
        }
    }
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// --- Metering snapshot ---

// GET /api/v1/metering
async fn get_metering(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let rx_count = cfg.rx_channels;
    let tx_count = cfg.tx_channels;
    drop(cfg);
    let meters = s.meters.read().await;
    let rx: HashMap<String, f32> = (0..rx_count)
        .map(|i| (format!("rx_{}", i), meters.rx_rms.get(i).copied().map(linear_to_dbfs).unwrap_or(-60.0)))
        .collect();
    let tx: HashMap<String, f32> = (0..tx_count)
        .map(|i| (format!("tx_{}", i), meters.tx_rms.get(i).copied().map(linear_to_dbfs).unwrap_or(-60.0)))
        .collect();
    let gr: HashMap<String, f32> = (0..tx_count)
        .map(|i| (format!("tx_{}", i), meters.tx_gr_db.get(i).copied().unwrap_or(0.0)))
        .collect();
    Json(MeteringResponse { rx, tx, gr })
}

// --- System info ---

// GET /api/v1/system
async fn get_system(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let zone_count = cfg.zone_config.len();
    let rx_count = cfg.rx_channels;
    let tx_count = cfg.tx_channels;
    let clock_path = cfg.dante_clock_path.clone();
    drop(cfg);
    let ptp_locked = tokio::time::timeout(
        Duration::from_millis(200),
        tokio::net::UnixStream::connect(&clock_path),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);
    let dante_status = if s.dante_connected.load(AOrdering::Relaxed) { "connected" } else { "disconnected" }.to_string();
    Json(SystemResponse {
        version: env!("CARGO_PKG_VERSION"),
        hostname: get_hostname(),
        uptime_s: s.started_at.elapsed().as_secs(),
        sample_rate: 48000,
        rx_count,
        tx_count,
        zone_count,
        dante_status,
        ptp_locked,
        audio_drops: s.resyncs.load(AOrdering::Relaxed),
    })
}

// GET /api/v1/system/config/export — download current config as TOML
async fn get_system_config_export(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match toml::to_string_pretty(&*cfg) {
        Ok(toml_str) => (
            [
                (header::CONTENT_TYPE, "application/toml"),
                (header::CONTENT_DISPOSITION, "attachment; filename=\"patchbox.toml\""),
            ],
            toml_str,
        ).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// POST /api/v1/system/config/import — upload a new TOML config (replaces current)
async fn post_system_config_import(State(s): State<AppState>, body: axum::body::Bytes) -> impl IntoResponse {
    let toml_str = match std::str::from_utf8(&body) {
        Ok(s) => s,
        Err(_) => return (StatusCode::BAD_REQUEST, "body is not valid UTF-8").into_response(),
    };
    let mut new_cfg: PatchboxConfig = match toml::from_str(toml_str) {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
    new_cfg.normalize();
    *s.config.write().await = new_cfg;
    let _ = s.persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// --- Scene gap endpoints ---

// GET /api/v1/scenes/:id — single scene
async fn get_scene_by_id(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let store = s.scenes.read().await;
    match store.scenes.get(&id) {
        Some(scene) => Json(scene.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/scenes/:id — update scene metadata
async fn put_scene(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<UpdateSceneRequest>) -> impl IntoResponse {
    let mut store = s.scenes.write().await;
    let Some(scene) = store.scenes.get_mut(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(name) = body.name {
        scene.name = name;
    }
    if let Some(desc) = body.description {
        scene.description = Some(desc);
    }
    if let Some(fav) = body.is_favourite {
        scene.is_favourite = fav;
    }
    drop(store);
    let _ = s.persist_scenes().await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/scenes/:id/diff — compare scene state vs current config
async fn get_scene_diff(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let store = s.scenes.read().await;
    let Some(scene) = store.scenes.get(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let scene = scene.clone();
    drop(store);
    let cfg = s.config.read().await;
    let mut changes = Vec::<serde_json::Value>::new();
    for (tx, row) in scene.matrix.iter().enumerate() {
        for (rx, &sv) in row.iter().enumerate() {
            let cv = cfg.matrix.get(tx).and_then(|r| r.get(rx)).copied().unwrap_or(false);
            if sv != cv {
                changes.push(serde_json::json!({"field": format!("matrix[{}][{}]", tx, rx), "scene": sv, "current": cv}));
            }
        }
    }
    for (i, (&sv, &cv)) in scene.input_gain_db.iter().zip(cfg.input_gain_db.iter()).enumerate() {
        if (sv - cv).abs() > 0.01 {
            changes.push(serde_json::json!({"field": format!("input_gain_db[{}]", i), "scene": sv, "current": cv}));
        }
    }
    for (i, (&sv, &cv)) in scene.output_gain_db.iter().zip(cfg.output_gain_db.iter()).enumerate() {
        if (sv - cv).abs() > 0.01 {
            changes.push(serde_json::json!({"field": format!("output_gain_db[{}]", i), "scene": sv, "current": cv}));
        }
    }
    Json(serde_json::json!({"scene_id": id, "changes": changes, "has_changes": !changes.is_empty()})).into_response()
}

// GET /ws
async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, s))
}

async fn handle_ws(mut socket: WebSocket, s: AppState) {
    let mut tick = interval(Duration::from_millis(50));
    loop {
        tick.tick().await;
        let meters = s.meters.read().await;
        let frame = MeterFrame {
            tx_rms: meters.tx_rms.clone(),
            rx_rms: meters.rx_rms.clone(),
            tx_peak: meters.tx_peak.clone(),
            rx_peak: meters.rx_peak.clone(),
            tx_gr_db: meters.tx_gr_db.clone(),
            rx_gr_db: meters.rx_gr_db.clone(),
            rx_gate_open: meters.rx_gate_open.clone(),
        };
        drop(meters);
        let json = match serde_json::to_string(&frame) { Ok(j) => j, Err(_) => continue };
        if socket.send(Message::Text(json.into())).await.is_err() { break; }
    }
}

// Static asset handlers (embedded via rust-embed)
async fn serve_ui() -> impl IntoResponse { serve_asset("index.html") }


// GET /api/v1/whoami — validate token and return user info
async fn whoami(
    State(_s): State<AppState>,
    req: axum::extract::Request,
) -> impl IntoResponse {
    let claims = req.extensions().get::<crate::jwt::Claims>().cloned();
    match claims {
        Some(c) => Json(serde_json::json!({"username": c.sub, "role": c.role, "zone": c.zone})).into_response(),
        None => (StatusCode::UNAUTHORIZED, "not authenticated").into_response(),
    }
}

pub fn router(state: AppState) -> Router {
    // Protected routes — require valid JWT
    let protected = Router::new()
        .route("/api/v1/whoami", get(whoami))
        .route("/api/v1/matrix", put(put_matrix))
        .route("/api/v1/gain/input", put(put_gain_input))
        .route("/api/v1/gain/output", put(put_gain_output))
        .route("/api/v1/zones/:tx/mute", post(mute_zone))
        .route("/api/v1/zones/:tx/unmute", post(unmute_zone))
        .route("/api/v1/mute-all", post(mute_all))
        .route("/api/v1/unmute-all", post(unmute_all))
        .route("/api/v1/scenes", get(list_scenes).post(save_scene))
        .route("/api/v1/scenes/:name/load", post(load_scene))
        .route("/api/v1/scenes/:name", get(get_scene_by_id).put(put_scene).delete(delete_scene))
        .route("/api/v1/scenes/:name/diff", get(get_scene_diff))
        .route("/api/v1/sources/:idx/name", put(put_source_name))
        .route("/api/v1/zones/:idx/name", put(put_zone_name))
        .route("/api/v1/zones/:tx/eq", get(get_eq).put(put_eq))
        .route("/api/v1/zones/:tx/eq/enabled", put(put_eq_enabled))
        .route("/api/v1/zones/:tx/limiter", get(get_limiter).put(put_limiter))
        .route("/api/v1/zones/:tx/limiter/enabled", put(put_limiter_enabled))
        // Input DSP
        .route("/api/v1/inputs/:ch/dsp", get(get_input_dsp))
        .route("/api/v1/inputs/:ch/gain", put(put_input_gain))
        .route("/api/v1/inputs/:ch/polarity", put(put_input_polarity))
        .route("/api/v1/inputs/:ch/hpf", put(put_input_hpf))
        .route("/api/v1/inputs/:ch/lpf", put(put_input_lpf))
        .route("/api/v1/inputs/:ch/eq", put(put_input_eq))
        .route("/api/v1/inputs/:ch/eq/enabled", put(put_input_eq_enabled))
        .route("/api/v1/inputs/:ch/gate", put(put_input_gate))
        .route("/api/v1/inputs/:ch/compressor", put(put_input_compressor))
        .route("/api/v1/inputs/:ch/enabled", put(put_input_enabled))
        // Output DSP
        .route("/api/v1/outputs/:ch/dsp", get(get_output_dsp))
        .route("/api/v1/outputs/:ch/gain", put(put_output_gain))
        .route("/api/v1/outputs/:ch/hpf", put(put_output_hpf))
        .route("/api/v1/outputs/:ch/lpf", put(put_output_lpf))
        .route("/api/v1/outputs/:ch/eq", put(put_output_eq))
        .route("/api/v1/outputs/:ch/eq/enabled", put(put_output_eq_enabled))
        .route("/api/v1/outputs/:ch/compressor", put(put_output_compressor))
        .route("/api/v1/outputs/:ch/limiter", put(put_output_limiter))
        .route("/api/v1/outputs/:ch/delay", put(put_output_delay))
        .route("/api/v1/outputs/:ch/enabled", put(put_output_enabled))
        .route("/api/v1/outputs/:ch/mute", put(put_output_mute))
        // Sprint 1 — Resource endpoints
        .route("/api/v1/channels", get(get_channels))
        .route("/api/v1/channels/:id", get(get_channel).put(put_channel))
        .route("/api/v1/outputs", get(get_outputs))
        .route("/api/v1/outputs/:id", get(get_output_resource).put(put_output_resource))
        .route("/api/v1/zones", get(get_zones_list).post(post_zone))
        .route("/api/v1/zones/:zone_id", put(put_zone_resource).delete(delete_zone_resource))
        .route("/api/v1/routes", get(get_routes).post(post_route).delete(delete_routes_bulk))
        .route("/api/v1/routes/:id", delete(delete_route))
        .route("/api/v1/metering", get(get_metering))
        .route("/api/v1/system", get(get_system))
        .route("/api/v1/system/config/export", get(get_system_config_export))
        .route("/api/v1/system/config/import", post(post_system_config_import))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_api::require_auth));

    // Public routes — no auth required
    Router::new()
        .route("/", get(serve_ui))
        .route("/ws", get(ws_handler))
        .route("/api/v1/health", get(get_health))
        .route("/api/v1/login", post(auth_api::login))
        .route("/api/v1/config", get(get_config))
        .merge(protected)
        .fallback(|req: axum::extract::Request| async move {
            let path = req.uri().path().trim_start_matches('/').to_string();
            serve_asset(&path)
        })
        .with_state(state)
}
