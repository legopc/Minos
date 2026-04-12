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
    InputChannelDsp, OutputChannelDsp,
    FilterConfig, EqConfig, GateConfig, CompressorConfig, LimiterConfig, DelayConfig,
};

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
async fn serve_ui()       -> impl IntoResponse { serve_asset("index.html") }
async fn serve_zone_ui()  -> impl IntoResponse { serve_asset("zone.html") }
async fn serve_css()      -> impl IntoResponse { serve_asset("style.css") }
async fn serve_app_js()   -> impl IntoResponse { serve_asset("app.js") }
async fn serve_zone_js()  -> impl IntoResponse { serve_asset("zone.js") }


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
        .route("/api/v1/scenes/:name", delete(delete_scene))
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
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_api::require_auth));

    // Public routes — no auth required
    Router::new()
        .route("/", get(serve_ui))
        .route("/zone/:name", get(serve_zone_ui))
        .route("/style.css", get(serve_css))
        .route("/app.js", get(serve_app_js))
        .route("/zone.js", get(serve_zone_js))
        .route("/ws", get(ws_handler))
        .route("/api/v1/health", get(get_health))
        .route("/api/v1/login", post(auth_api::login))
        .route("/api/v1/config", get(get_config))
        .merge(protected)
        .with_state(state)
}
