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
use tokio::time::{interval, Duration};
use std::sync::Arc;
use std::net::{IpAddr, SocketAddr};
use std::num::NonZeroU32;
use std::os::unix::fs::FileTypeExt;
use axum::extract::ConnectInfo;
use axum::http::Request;
use axum::middleware::Next;
use governor::{Quota, RateLimiter, clock::DefaultClock, state::keyed::DefaultKeyedStateStore};

type IpLimiter = Arc<RateLimiter<IpAddr, DefaultKeyedStateStore<IpAddr>, DefaultClock>>;

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

/// Returns HTTP 500 with structured JSON if config persist fails.
/// The change remains live in memory until next restart (documented in response body).
macro_rules! persist_or_500 {
    ($state:expr) => {
        if let Err(e) = $state.persist().await {
            tracing::error!(error = %e, "config persist failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("persist failed: {e}"), "in_memory": true}))
            ).into_response();
        }
    };
}

macro_rules! persist_scenes_or_500 {
    ($state:expr) => {
        if let Err(e) = $state.persist_scenes().await {
            tracing::error!(error = %e, "scenes persist failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("scenes persist failed: {e}"), "in_memory": true}))
            ).into_response();
        }
    };
}

#[derive(Deserialize)]
pub struct MatrixUpdate {
    pub tx: usize,
    pub rx: usize,
    pub enabled: bool,
    /// Optional per-crosspoint gain in dB. Only applied when enabled=true. Range: [-40, 12].
    pub gain_db: Option<f32>,
}

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
pub struct HealthPtp {
    pub synced: bool,
    pub socket_path: String,
    /// PTP offset from master in nanoseconds. None if observation socket not configured or unreachable.
    pub offset_ns: Option<i64>,
}

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

/// Query statime observation Unix socket for PTP offset from master.
/// Connects with a 100ms timeout, reads Prometheus text, parses `offset_from_master`.
/// Returns None if socket unreachable or metric missing.
async fn query_ptp_offset(socket_path: &str) -> Option<i64> {
    use tokio::io::AsyncReadExt;
    let connect = tokio::net::UnixStream::connect(socket_path);
    let mut stream = tokio::time::timeout(Duration::from_millis(100), connect).await.ok()?.ok()?;
    let mut buf = String::new();
    let read = tokio::time::timeout(Duration::from_millis(200), stream.read_to_string(&mut buf)).await;
    if read.is_err() { return None; }
    // Parse: "statime_offset_from_master{...} <value>"
    for line in buf.lines() {
        if line.starts_with("statime_offset_from_master") && !line.starts_with('#') {
            if let Some(val_str) = line.split_whitespace().last() {
                if let Ok(secs) = val_str.parse::<f64>() {
                    return Some((secs * 1_000_000_000.0) as i64);
                }
            }
        }
    }
    None
}

// GET /api/v1/health
async fn get_health(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let meters = s.meters.read().await;

    // PTP: check clock socket is actually a socket (not just any file)
    let ptp_socket_path = cfg.dante_clock_path.clone();
    let ptp_synced = std::fs::metadata(&ptp_socket_path)
        .map(|m| m.file_type().is_socket())
        .unwrap_or(false);

    // Attempt to read real offset from statime observation socket (optional)
    let ptp_offset_ns = if let Some(obs_path) = &cfg.statime_observation_path {
        query_ptp_offset(obs_path).await
    } else {
        None
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
            offset_ns: ptp_offset_ns,
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
    if let Some(db) = u.gain_db {
        cfg.matrix_gain_db[u.tx][u.rx] = db.clamp(-40.0, 12.0);
    }
    drop(cfg);
    persist_or_500!(s);
    StatusCode::OK.into_response()
}

// GET /api/v1/matrix
#[derive(Serialize)]
struct MatrixState {
    enabled: Vec<Vec<bool>>,
    gain_db: Vec<Vec<f32>>,
}

async fn get_matrix(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(MatrixState {
        enabled: cfg.matrix.clone(),
        gain_db: cfg.matrix_gain_db.clone(),
    })
}

// PUT /api/v1/gain/input
async fn put_gain_input(State(s): State<AppState>, Json(u): Json<GainUpdate>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if u.channel >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "out of range").into_response();
    }
    cfg.input_gain_db[u.channel] = u.db.clamp(-60.0, 12.0);
    drop(cfg);
    persist_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/mute-all — panic button: silence all zones
async fn mute_all(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() { *m = true; }
    drop(cfg);
    persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/unmute-all — restore all zones
async fn unmute_all(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() { *m = false; }
    drop(cfg);
    persist_or_500!(s);
    StatusCode::OK.into_response()
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
    persist_scenes_or_500!(s);
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
    s.scenes.write().await.active = Some(name.clone());
    persist_or_500!(s);
    persist_scenes_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"scene_loaded","scene_id":&name,"name":&name}).to_string());
    // Clear solo state on scene load — solo does not persist across scene changes
    {
        let mut cfg = s.config.write().await;
        cfg.solo_channels.clear();
        let monitor_device = cfg.monitor_device.clone();
        drop(cfg);
        ws_broadcast(&s, serde_json::json!({
            "type": "solo_update",
            "channels": Vec::<usize>::new(),
            "monitor_device": monitor_device,
        }).to_string());
    }
    StatusCode::OK.into_response()
}

// DELETE /api/v1/scenes/:name
async fn delete_scene(State(s): State<AppState>, Path(name): Path<String>) -> impl IntoResponse {
    let mut store = s.scenes.write().await;
    if store.scenes.remove(&name).is_none() {
        return (StatusCode::NOT_FOUND, "scene not found").into_response();
    }
    drop(store);
    persist_scenes_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

use patchbox_core::config::{
    PatchboxConfig,
    ZoneConfig,
    InputChannelDsp, InternalBusConfig, OutputChannelDsp,
    FilterConfig, EqConfig, GateConfig, CompressorConfig, LimiterConfig, DelayConfig,
};

use std::collections::HashMap;
use axum::extract::Query;

#[derive(Deserialize)] struct GainBody { gain_db: f32 }
#[derive(Deserialize)] struct EnabledBody { enabled: bool }
#[derive(Deserialize)] struct MutedBody { muted: bool }
#[derive(Deserialize)] struct PolarityBody { invert: bool }

#[derive(Debug, Deserialize)]
struct AdminChannelsReq {
    rx: usize,
    tx: usize,
    bus_count: Option<usize>,
}

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
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/polarity
async fn put_input_polarity(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<PolarityBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.polarity = body.invert;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/hpf
async fn put_input_hpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.hpf = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/lpf
async fn put_input_lpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.lpf = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/eq
async fn put_input_eq(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EqConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/eq/enabled
async fn put_input_eq_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq.enabled = body.enabled;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/gate
async fn put_input_gate(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<GateConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.gate = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/compressor
async fn put_input_compressor(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<CompressorConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.compressor = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/enabled
async fn put_input_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.enabled = body.enabled;
    drop(cfg);
    persist_or_500!(s);
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
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/hpf
async fn put_output_hpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.hpf = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/lpf
async fn put_output_lpf(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.lpf = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq
async fn put_output_eq(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EqConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq/enabled
async fn put_output_eq_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.eq.enabled = body.enabled;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/compressor
async fn put_output_compressor(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<CompressorConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.compressor = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/limiter
async fn put_output_limiter(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<LimiterConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.limiter = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/delay
async fn put_output_delay(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<DelayConfig>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.delay = body;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/dither
#[derive(Deserialize)]
struct DitherBody { bits: u8 }

async fn put_output_dither(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<DitherBody>) -> impl IntoResponse {
    if body.bits != 0 && body.bits != 16 && body.bits != 24 {
        return (StatusCode::BAD_REQUEST, "bits must be 0, 16, or 24").into_response();
    }
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.dither_bits = body.bits;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/enabled
async fn put_output_enabled(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.enabled = body.enabled;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/mute — alias: set muted state directly
async fn put_output_mute(State(s): State<AppState>, Path(ch): Path<usize>, Json(body): Json<MutedBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else { return StatusCode::NOT_FOUND.into_response(); };
    dsp.muted = body.muted;
    drop(cfg);
    persist_or_500!(s);
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

fn parse_bus_id(id: &str) -> Option<usize> {
    id.strip_prefix("bus_")?.parse().ok()
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
        "am": {"enabled": true, "bypassed": dsp.gain_db == 0.0_f32 && !dsp.polarity, "params": {"gain_db": dsp.gain_db, "invert_polarity": dsp.polarity}},
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
        "dly": {"enabled": dsp.delay.enabled, "bypassed": !dsp.delay.enabled, "params": serde_json::json!({
            "delay_ms": dsp.delay.delay_ms,
            "bypassed": !dsp.delay.enabled,
            "dither_bits": dsp.dither_bits,
        })},
    })
}

fn linear_to_dbfs(v: f32) -> f32 {
    if v <= 0.0 { return -60.0; }
    (20.0 * v.log10()).max(-60.0)
}

fn bus_to_response(idx: usize, bus: &InternalBusConfig) -> BusResponse {
    BusResponse {
        id: bus.id.clone(),
        name: bus.name.clone(),
        muted: bus.muted,
        dsp: input_dsp_to_value(&bus.dsp),
    }
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
    bus_count: usize,
    show_buses_in_mixer: bool,
    monitor_device: Option<String>,
    monitor_volume_db: f32,
}

#[derive(Serialize)]
struct BusResponse {
    id: String,
    name: String,
    muted: bool,
    dsp: serde_json::Value,
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

// --- Request types: buses ---

#[derive(Deserialize)]
struct CreateBusRequest {
    name: Option<String>,
}

#[derive(Deserialize)]
struct UpdateBusRequest {
    name: Option<String>,
    muted: Option<bool>,
}

#[derive(Deserialize)]
struct BusRoutingBody {
    routing: Vec<bool>,
}

#[derive(Deserialize)]
struct BusMatrixBody {
    matrix: Vec<Vec<bool>>,
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
    persist_or_500!(s);
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
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"output_update","id":&id,"volume_db":body.volume_db,"muted":body.muted}).to_string());
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
    persist_or_500!(s);
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
    persist_or_500!(s);
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
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}


// ===========================================================================
// Sprint E — Internal bus endpoints
// ===========================================================================

// GET /api/v1/buses
async fn get_buses(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let buses: Vec<BusResponse> = cfg.internal_buses.iter().enumerate()
        .map(|(i, b)| bus_to_response(i, b))
        .collect();
    Json(buses)
}

// POST /api/v1/buses
async fn post_bus(State(s): State<AppState>, Json(body): Json<CreateBusRequest>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let idx = cfg.internal_buses.len();
    let id = format!("bus_{}", idx);
    let name = body.name.unwrap_or_else(|| format!("Bus {}", idx + 1));
    let bus = patchbox_core::config::InternalBusConfig {
        id: id.clone(),
        name: name.clone(),
        routing: vec![false; cfg.rx_channels],
        routing_gain: vec![0.0; cfg.rx_channels],
        dsp: patchbox_core::config::InputChannelDsp::default(),
        muted: false,
    };
    if let Some(bm) = cfg.bus_matrix.as_mut() {
        for row in bm.iter_mut() {
            row.push(false);
        }
    } else if cfg.tx_channels > 0 {
        cfg.bus_matrix = Some(vec![vec![false]; cfg.tx_channels]);
    }
    let resp = bus_to_response(idx, &bus);
    cfg.internal_buses.push(bus);
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_created","bus":serde_json::to_value(&resp).unwrap_or_default()}).to_string());
    (StatusCode::CREATED, Json(resp)).into_response()
}

// GET /api/v1/buses/:id
async fn get_bus(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid bus id (expected bus_N)").into_response();
    };
    let cfg = s.config.read().await;
    match cfg.internal_buses.get(i) {
        Some(b) => Json(bus_to_response(i, b)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/buses/:id
async fn put_bus(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<UpdateBusRequest>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid bus id (expected bus_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(name) = body.name { cfg.internal_buses[i].name = name; }
    if let Some(muted) = body.muted { cfg.internal_buses[i].muted = muted; }
    let ev = serde_json::json!({"type":"bus_update","id":&id,"name":cfg.internal_buses[i].name.clone(),"muted":cfg.internal_buses[i].muted});
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, ev.to_string());
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/buses/:id
async fn delete_bus(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid bus id (expected bus_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    cfg.internal_buses.remove(i);
    if let Some(bm) = cfg.bus_matrix.as_mut() {
        for row in bm.iter_mut() {
            if i < row.len() { row.remove(i); }
        }
    }
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_deleted","id":&id}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/gain
async fn put_bus_gain(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<GainBody>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.gain_db = body.gain_db.clamp(-60.0, 24.0);
    let ev = serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"am","params":{"gain_db":bus.dsp.gain_db}});
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, ev.to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/polarity
async fn put_bus_polarity(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<PolarityBody>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.polarity = body.invert;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"am","params":{"invert_polarity":body.invert}}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/hpf
async fn put_bus_hpf(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.hpf = body;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"flt"}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/lpf
async fn put_bus_lpf(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<FilterConfig>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.lpf = body;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"flt"}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/eq
async fn put_bus_eq(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<EqConfig>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.eq = body;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"peq"}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/eq/enabled
async fn put_bus_eq_enabled(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<EnabledBody>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.eq.enabled = body.enabled;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"peq","params":{"enabled":body.enabled}}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/gate
async fn put_bus_gate(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<GateConfig>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.gate = body;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"gte"}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/compressor
async fn put_bus_compressor(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<CompressorConfig>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.dsp.compressor = body;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"cmp"}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/mute
async fn put_bus_mute(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<MutedBody>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else { return StatusCode::NOT_FOUND.into_response(); };
    bus.muted = body.muted;
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_update","id":&id,"muted":body.muted}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/routing
async fn put_bus_routing(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<BusRoutingBody>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() { return StatusCode::NOT_FOUND.into_response(); }
    let rx_channels = cfg.rx_channels;
    let mut routing = body.routing;
    routing.resize(rx_channels, false);
    cfg.internal_buses[i].routing = routing.clone();
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_routing_update","id":&id,"routing":routing}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/input-gain
#[derive(Deserialize)]
struct BusInputGainBody { rx: usize, gain_db: f32 }

async fn put_bus_input_gain(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<BusInputGainBody>) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else { return StatusCode::BAD_REQUEST.into_response(); };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() { return StatusCode::NOT_FOUND.into_response(); }
    if body.rx >= cfg.rx_channels { return StatusCode::BAD_REQUEST.into_response(); }
    let clamped = body.gain_db.clamp(-40.0, 12.0);
    cfg.internal_buses[i].routing_gain[body.rx] = clamped;
    drop(cfg);
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/bus-matrix
async fn put_bus_matrix(State(s): State<AppState>, Json(body): Json<BusMatrixBody>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let n_buses = cfg.internal_buses.len();
    let tx_channels = cfg.tx_channels;
    let mut matrix = body.matrix;
    matrix.resize(tx_channels, vec![false; n_buses]);
    for row in matrix.iter_mut() {
        row.resize(n_buses, false);
    }
    cfg.bus_matrix = Some(matrix.clone());
    drop(cfg);
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_matrix_update","matrix":matrix}).to_string());
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
    // Bus→TX routes
    if let Some(bm) = cfg.bus_matrix.as_ref() {
        for (tx, row) in bm.iter().enumerate() {
            for (b, &enabled) in row.iter().enumerate() {
                if enabled {
                    routes.push(RouteResponse {
                        id: format!("bus_{}|tx_{}", b, tx),
                        rx_id: format!("bus_{}", b),
                        tx_id: format!("tx_{}", tx),
                        route_type: "bus",
                    });
                }
            }
        }
    }
    Json(routes)
}

// POST /api/v1/routes
async fn post_route(State(s): State<AppState>, Json(body): Json<CreateRouteRequest>) -> impl IntoResponse {
    // Handle bus→TX route
    if body.rx_id.starts_with("bus_") {
        let Some(b) = parse_bus_id(&body.rx_id) else {
            return (StatusCode::BAD_REQUEST, "invalid bus rx_id").into_response();
        };
        let Some(tx) = parse_tx_id(&body.tx_id) else {
            return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response();
        };
        let mut cfg = s.config.write().await;
        if tx >= cfg.tx_channels || b >= cfg.internal_buses.len() {
            return (StatusCode::BAD_REQUEST, "index out of range").into_response();
        }
        let n_buses = cfg.internal_buses.len();
        let tx_channels = cfg.tx_channels;
        if cfg.bus_matrix.is_none() {
            cfg.bus_matrix = Some(vec![vec![false; n_buses]; tx_channels]);
        }
        if let Some(bm) = cfg.bus_matrix.as_mut() {
            if tx < bm.len() && b < bm[tx].len() {
                bm[tx][b] = true;
            }
        }
        drop(cfg);
        persist_or_500!(s);
        ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":&body.rx_id,"tx_id":&body.tx_id,"state":"on","route_type":"bus"}).to_string());
        let route_id = format!("bus_{}|tx_{}", b, tx);
        return (StatusCode::CREATED, Json(serde_json::json!({
            "id": route_id,
            "rx_id": body.rx_id,
            "tx_id": body.tx_id,
            "route_type": "bus"
        }))).into_response();
    }
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
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":&body.rx_id,"tx_id":&body.tx_id,"state":"on","route_type":"dante"}).to_string());
    let route_id = format!("rx_{}|tx_{}", rx, tx);
    (StatusCode::CREATED, Json(serde_json::json!({
        "id": route_id,
        "rx_id": body.rx_id,
        "tx_id": body.tx_id,
        "route_type": "dante"
    }))).into_response()
}

// DELETE /api/v1/routes/:id — id is "rx_N|tx_M" (| may be URL-encoded as %7C)
async fn delete_route(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let parts: Vec<&str> = id.splitn(2, '|').collect();
    if parts.len() != 2 {
        return (StatusCode::BAD_REQUEST, "invalid route id — expected rx_N|tx_M").into_response();
    }
    // Handle bus→TX route: "bus_N|tx_M"
    if parts[0].starts_with("bus_") {
        let Some(b) = parse_bus_id(parts[0]) else {
            return (StatusCode::BAD_REQUEST, "invalid bus part in route id").into_response();
        };
        let Some(tx) = parse_tx_id(parts[1]) else {
            return (StatusCode::BAD_REQUEST, "invalid tx part in route id").into_response();
        };
        let mut cfg = s.config.write().await;
        if let Some(bm) = cfg.bus_matrix.as_mut() {
            if let Some(row) = bm.get_mut(tx) {
                if b < row.len() { row[b] = false; }
            }
        }
        drop(cfg);
        persist_or_500!(s);
        ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":format!("bus_{}",b),"tx_id":format!("tx_{}",tx),"state":"off","route_type":"bus"}).to_string());
        return StatusCode::NO_CONTENT.into_response();
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
    persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":format!("rx_{}",rx),"tx_id":format!("tx_{}",tx),"state":"off","route_type":"dante"}).to_string());
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
    persist_or_500!(s);
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
    let bus_count = cfg.internal_buses.len();
    let show_buses_in_mixer = cfg.show_buses_in_mixer;
    let monitor_device = cfg.monitor_device.clone();
    let monitor_volume_db = cfg.monitor_volume_db;
    drop(cfg);
    let dante_connected = s.dante_connected.load(AOrdering::Relaxed);
    let ptp_locked = dante_connected;
    let dante_status = if dante_connected { "connected" } else { "disconnected" }.to_string();
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
        bus_count,
        show_buses_in_mixer,
        monitor_device,
        monitor_volume_db,
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
    // Snapshot current config before replacing
    let _ = _create_backup(&s).await;
    new_cfg.normalize();
    *s.config.write().await = new_cfg;
    persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// Helper: write a timestamped backup, keeping only last 10.
async fn _create_backup(s: &AppState) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let cfg = s.config.read().await;
    let toml_str = toml::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
    drop(cfg);
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let bak_path = s.config_path.with_file_name(format!(
        "{}-bak-{}.toml",
        s.config_path.file_stem().and_then(|s| s.to_str()).unwrap_or("patchbox"),
        ts
    ));
    std::fs::write(&bak_path, &toml_str).map_err(|e| e.to_string())?;

    // Prune: keep only last 10 backups
    if let Some(dir) = s.config_path.parent() {
        let stem = s.config_path.file_stem().and_then(|s| s.to_str()).unwrap_or("patchbox").to_string();
        let mut baks: Vec<_> = std::fs::read_dir(dir)
            .ok().into_iter().flatten()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name();
                let n = n.to_string_lossy();
                n.starts_with(&format!("{}-bak-", stem)) && n.ends_with(".toml")
            })
            .collect();
        baks.sort_by_key(|e| e.file_name());
        if baks.len() > 10 {
            for old in &baks[..baks.len() - 10] {
                let _ = std::fs::remove_file(old.path());
            }
        }
    }
    Ok(bak_path.to_string_lossy().into_owned())
}

// GET /api/v1/system/config/backups — list available backups
async fn get_config_backups(State(s): State<AppState>) -> impl IntoResponse {
    let stem = s.config_path.file_stem().and_then(|s| s.to_str()).unwrap_or("patchbox").to_string();
    let dir = match s.config_path.parent() {
        Some(d) => d,
        None => return Json(serde_json::json!([])).into_response(),
    };
    let mut baks: Vec<serde_json::Value> = std::fs::read_dir(dir)
        .ok().into_iter().flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            n.starts_with(&format!("{}-bak-", stem)) && n.ends_with(".toml")
        })
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Extract timestamp from filename: "patchbox-bak-1234567890.toml"
            let ts: u64 = name
                .strip_prefix(&format!("{}-bak-", stem))
                .and_then(|s| s.strip_suffix(".toml"))
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            Some(serde_json::json!({ "name": name, "timestamp": ts }))
        })
        .collect();
    baks.sort_by(|a, b| b["timestamp"].as_u64().cmp(&a["timestamp"].as_u64()));
    Json(baks).into_response()
}

// GET /api/v1/system/config/backups/:name — download a backup
async fn get_config_backup(State(s): State<AppState>, Path(name): Path<String>) -> impl IntoResponse {
    if name.contains('/') || name.contains("..") {
        return (StatusCode::BAD_REQUEST, "invalid backup name").into_response();
    }
    let dir = match s.config_path.parent() {
        Some(d) => d,
        None => return StatusCode::NOT_FOUND.into_response(),
    };
    let path = dir.join(&name);
    match std::fs::read_to_string(&path) {
        Ok(content) => (
            [(header::CONTENT_TYPE, "application/toml"),
             (header::CONTENT_DISPOSITION, &format!("attachment; filename=\"{name}\"") as &str)],
            content,
        ).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// POST /api/v1/system/config/backups/:name/restore — restore a backup
async fn restore_config_backup(State(s): State<AppState>, Path(name): Path<String>) -> impl IntoResponse {
    if name.contains('/') || name.contains("..") {
        return (StatusCode::BAD_REQUEST, "invalid backup name").into_response();
    }
    let dir = match s.config_path.parent() {
        Some(d) => d,
        None => return StatusCode::NOT_FOUND.into_response(),
    };
    let path = dir.join(&name);
    let toml_str = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let mut new_cfg: PatchboxConfig = match toml::from_str(&toml_str) {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
    // Backup current before restore
    let _ = _create_backup(&s).await;
    new_cfg.normalize();
    *s.config.write().await = new_cfg;
    persist_or_500!(s);
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
    persist_scenes_or_500!(s);
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
// ─── WebSocket broadcast helper ──────────────────────────────────────────────

/// Send an event JSON string to all connected WS clients. Errors are silently
/// dropped (no clients = zero receivers, which is fine).
fn ws_broadcast(s: &AppState, msg: String) {
    let _ = s.ws_tx.send(msg);
}

// ─── Sprint F: Solo / PFL + Monitor endpoints ────────────────────────────────

#[derive(serde::Deserialize)]
struct SoloRequest { channels: Vec<usize> }

#[derive(serde::Serialize)]
struct SoloResponse {
    channels: Vec<usize>,
    monitor_device: Option<String>,
}

async fn get_solo(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(SoloResponse {
        channels: cfg.solo_channels.clone(),
        monitor_device: cfg.monitor_device.clone(),
    })
}

async fn put_solo(State(s): State<AppState>, Json(body): Json<SoloRequest>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    cfg.solo_channels = body.channels.into_iter()
        .filter(|&rx| rx < cfg.rx_channels)
        .collect();
    cfg.solo_channels.sort_unstable();
    cfg.solo_channels.dedup();
    let resp = SoloResponse {
        channels: cfg.solo_channels.clone(),
        monitor_device: cfg.monitor_device.clone(),
    };
    ws_broadcast(&s, serde_json::json!({
        "type": "solo_update",
        "channels": &resp.channels,
        "monitor_device": &resp.monitor_device,
    }).to_string());
    Json(resp)
}

async fn toggle_solo(State(s): State<AppState>, Path(rx): Path<usize>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "Invalid RX index").into_response();
    }
    if let Some(pos) = cfg.solo_channels.iter().position(|&c| c == rx) {
        cfg.solo_channels.remove(pos);
    } else {
        cfg.solo_channels.push(rx);
        cfg.solo_channels.sort_unstable();
    }
    let resp = SoloResponse {
        channels: cfg.solo_channels.clone(),
        monitor_device: cfg.monitor_device.clone(),
    };
    ws_broadcast(&s, serde_json::json!({
        "type": "solo_update",
        "channels": &resp.channels,
        "monitor_device": &resp.monitor_device,
    }).to_string());
    Json(resp).into_response()
}

async fn delete_solo(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    cfg.solo_channels.clear();
    ws_broadcast(&s, serde_json::json!({
        "type": "solo_update",
        "channels": Vec::<usize>::new(),
        "monitor_device": &cfg.monitor_device,
    }).to_string());
    StatusCode::NO_CONTENT
}

#[derive(serde::Deserialize)]
struct MonitorRequest {
    device: Option<String>,
    #[serde(default)]
    volume_db: f32,
}

#[derive(serde::Serialize)]
struct MonitorResponse {
    device: Option<String>,
    volume_db: f32,
}

async fn get_monitor(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(MonitorResponse {
        device: cfg.monitor_device.clone(),
        volume_db: cfg.monitor_volume_db,
    })
}

async fn put_monitor(State(s): State<AppState>, Json(body): Json<MonitorRequest>) -> impl IntoResponse {
    if body.volume_db < -60.0 || body.volume_db > 12.0 {
        return (StatusCode::BAD_REQUEST, "volume_db out of range [-60, 12]").into_response();
    }
    {
        let mut cfg = s.config.write().await;
        cfg.monitor_device = body.device.clone();
        cfg.monitor_volume_db = body.volume_db;
    }
    if let Err(e) = s.persist().await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response();
    }
    ws_broadcast(&s, serde_json::json!({
        "type": "monitor_config_update",
        "device": &body.device,
        "volume_db": body.volume_db,
    }).to_string());
    Json(MonitorResponse { device: body.device, volume_db: body.volume_db }).into_response()
}

async fn list_audio_devices() -> impl IntoResponse {
    #[cfg(feature = "inferno")]
    {
        let devs = patchbox_dante::monitor::enumerate_devices();
        let list: Vec<serde_json::Value> = devs.iter().map(|(name, desc)| {
            serde_json::json!({ "name": name, "description": desc })
        }).collect();
        return Json(serde_json::json!({ "devices": list })).into_response();
    }
    #[cfg(not(feature = "inferno"))]
    Json(serde_json::json!({ "devices": [] })).into_response()
}

// ─── WebSocket handler ────────────────────────────────────────────────────────

async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, s))
}

/// Per-client WS task. Splits into send + receive halves.
async fn handle_ws(socket: WebSocket, s: AppState) {
    use axum::extract::ws::Message;
    use futures_util::{SinkExt, StreamExt};
    use tokio::sync::oneshot;
    use tokio::time::Duration;

    let (mut sender, mut receiver) = socket.split();

    // --- hello ---
    {
        let cfg = s.config.read().await;
        let hello = serde_json::json!({
            "type": "hello",
            "version": env!("CARGO_PKG_VERSION"),
            "rx_count": cfg.rx_channels,
            "tx_count": cfg.tx_channels,
            "zone_count": cfg.zone_config.len(),
            "solo_channels": &cfg.solo_channels,
            "monitor_device": &cfg.monitor_device,
        });
        let _ = sender.send(Message::Text(hello.to_string().into())).await;
    }

    // Subscribe to broadcast channel *before* spawning the send task
    let mut rx = s.ws_tx.subscribe();

    // Track which IDs the client wants metered (None = all)
    use std::sync::Arc;
    use tokio::sync::Mutex;
    let subscribed: Arc<Mutex<Option<Vec<String>>>> = Arc::new(Mutex::new(None));
    let subscribed_send = subscribed.clone();

    // Cancel channel: either side can signal the other to stop
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let (cancel_tx2, cancel_rx2) = oneshot::channel::<()>();

    // --- Send task: metering loop + broadcast relay ---
    let state_send = s.clone();
    let send_task = tokio::spawn(async move {
        let mut meter_tick = interval(Duration::from_millis(200));
        tokio::pin!(cancel_rx);
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,   // receive loop signalled us to stop
                _ = meter_tick.tick() => {
                    let meters = state_send.meters.read().await;
                    let filter = subscribed_send.lock().await;

                    let mut rx_map = serde_json::Map::new();
                    for (i, &v) in meters.rx_rms.iter().enumerate() {
                        let id = format!("rx_{}", i);
                        if filter.as_ref().map_or(true, |f| f.contains(&id)) {
                            rx_map.insert(id, serde_json::json!(linear_to_dbfs(v)));
                        }
                    }
                    let mut tx_map = serde_json::Map::new();
                    for (i, &v) in meters.tx_rms.iter().enumerate() {
                        let id = format!("tx_{}", i);
                        if filter.as_ref().map_or(true, |f| f.contains(&id)) {
                            tx_map.insert(id, serde_json::json!(linear_to_dbfs(v)));
                        }
                    }
                    let mut gr_map = serde_json::Map::new();
                    for (i, &v) in meters.tx_gr_db.iter().enumerate() {
                        gr_map.insert(format!("tx_{}_lim", i), serde_json::json!(v));
                    }
                    let mut bus_map = serde_json::Map::new();
                    for (i, &v) in meters.bus_rms.iter().enumerate() {
                        let id = format!("bus_{}", i);
                        if filter.as_ref().map_or(true, |f| f.contains(&id)) {
                            bus_map.insert(id, serde_json::json!(linear_to_dbfs(v)));
                        }
                    }
                    for (i, &v) in meters.rx_gr_db.iter().enumerate() {
                        gr_map.insert(format!("rx_{}_cmp", i), serde_json::json!(v));
                    }
                    let mut peak_map = serde_json::Map::new();
                    for (i, &v) in meters.rx_peak.iter().enumerate() {
                        peak_map.insert(format!("rx_{}", i), serde_json::json!(linear_to_dbfs(v)));
                    }
                    for (i, &v) in meters.tx_peak.iter().enumerate() {
                        peak_map.insert(format!("tx_{}", i), serde_json::json!(linear_to_dbfs(v)));
                    }
                    let mut clip_map = serde_json::Map::new();
                    for (i, &v) in meters.rx_clip_count.iter().enumerate() {
                        clip_map.insert(format!("rx_{}", i), serde_json::json!(v));
                    }
                    for (i, &v) in meters.tx_clip_count.iter().enumerate() {
                        clip_map.insert(format!("tx_{}", i), serde_json::json!(v));
                    }
                    drop(filter);
                    drop(meters);

                    let msg = serde_json::json!({
                        "type": "metering",
                        "rx": rx_map,
                        "tx": tx_map,
                        "gr": gr_map,
                        "bus": bus_map,
                        "peak": peak_map,
                        "clip": clip_map
                    });
                    if sender.send(Message::Text(msg.to_string().into())).await.is_err() {
                        break;
                    }
                }
                result = rx.recv() => {
                    match result {
                        Ok(event) => {
                            if sender.send(Message::Text(event.into())).await.is_err() { break; }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(n, "WS broadcast lagged — closing connection");
                            break;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
        // Signal receive loop that send died
        let _ = cancel_tx2.send(());
        // Best-effort close frame
        let _ = tokio::time::timeout(Duration::from_millis(500), sender.close()).await;
    });

    // --- Receive loop with 30s inactivity deadline ---
    let mut deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    tokio::pin!(cancel_rx2);
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {
                tracing::debug!("WS inactivity timeout — closing");
                break;
            }
            _ = &mut cancel_rx2 => break,  // send task died
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        deadline = tokio::time::Instant::now() + Duration::from_secs(30);
                        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
                        match v.get("type").and_then(|t| t.as_str()) {
                            Some("ping") => {
                                let _ = s.ws_tx.send(serde_json::json!({"type":"pong"}).to_string());
                            }
                            Some("subscribe_metering") => {
                                if let Some(ids) = v.get("ids").and_then(|i| i.as_array()) {
                                    let list: Vec<String> = ids.iter()
                                        .filter_map(|x| x.as_str().map(String::from))
                                        .collect();
                                    *subscribed.lock().await = Some(list);
                                }
                            }
                            Some("resync") => { /* no-op for now */ }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Ping(_))) => {
                        deadline = tokio::time::Instant::now() + Duration::from_secs(30);
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    let _ = cancel_tx.send(());  // signal send task if still running
    send_task.abort();
}

// Static asset handlers (embedded via rust-embed)
async fn serve_ui() -> impl IntoResponse { serve_asset("index.html") }

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "css"   => "text/css; charset=utf-8",
        "js"    => "application/javascript; charset=utf-8",
        "html"  => "text/html; charset=utf-8",
        "svg"   => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff"  => "font/woff",
        "ico"   => "image/x-icon",
        "png"   => "image/png",
        _       => "application/octet-stream",
    }
}

/// Dev mode: serve a file from disk with no-cache headers.
/// Falls back to index.html for unmatched paths (SPA routing).
async fn dev_asset(dev_dir: String, req: axum::extract::Request) -> Response {
    let uri_path = req.uri().path().trim_start_matches('/');
    let file_path = if uri_path.is_empty() {
        std::path::PathBuf::from(&dev_dir).join("index.html")
    } else {
        std::path::PathBuf::from(&dev_dir).join(uri_path)
    };

    match tokio::fs::read(&file_path).await {
        Ok(bytes) => {
            let mime = file_path
                .extension()
                .and_then(|e| e.to_str())
                .map(mime_for_ext)
                .unwrap_or("application/octet-stream");
            (
                [
                    (header::CONTENT_TYPE, mime),
                    (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
                ],
                bytes,
            )
                .into_response()
        }
        Err(_) => {
            // SPA fallback: serve index.html for any path that isn't a known file
            let index = std::path::PathBuf::from(&dev_dir).join("index.html");
            match tokio::fs::read(&index).await {
                Ok(bytes) => (
                    [
                        (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                        (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
                    ],
                    bytes,
                )
                    .into_response(),
                Err(e) => {
                    tracing::error!("DEV: failed to read index.html from {dev_dir}: {e}");
                    StatusCode::NOT_FOUND.into_response()
                }
            }
        }
    }
}


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

async fn post_admin_channels(
    State(state): State<AppState>,
    Json(body): Json<AdminChannelsReq>,
) -> impl IntoResponse {
    if body.rx < 1 || body.rx > 32 || body.tx < 1 || body.tx > 32 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "channel count out of range (1-32)"}))).into_response();
    }
    {
        let mut cfg = state.config.write().await;
        cfg.rx_channels = body.rx;
        cfg.tx_channels = body.tx;
        if let Some(count) = body.bus_count {
            let count = count.min(8);
            let rx = cfg.rx_channels;
            // Grow: add buses with unique sequential IDs
            while cfg.internal_buses.len() < count {
                let idx = cfg.internal_buses.len();
                cfg.internal_buses.push(InternalBusConfig {
                    id: format!("bus_{}", idx),
                    name: format!("Bus {}", idx + 1),
                    routing: vec![false; rx],
                    routing_gain: vec![0.0; rx],
                    dsp: patchbox_core::config::InputChannelDsp::default(),
                    muted: false,
                });
            }
            // Shrink: truncate to requested count
            cfg.internal_buses.truncate(count);
        }
        cfg.normalize();
    }
    if let Err(e) = state.persist().await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("persist failed: {}", e)}))).into_response();
    }
    // Exit cleanly — systemd Restart=always handles production; dev mode user restarts manually
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        std::process::exit(0);
    });
    (StatusCode::OK, Json(serde_json::json!({"ok": true, "restarting": true}))).into_response()
}

async fn post_admin_restart(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let _ = state.persist().await;
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        std::process::exit(0);
    });
    (StatusCode::OK, Json(serde_json::json!({"ok": true, "restarting": true}))).into_response()
}

/// Per-IP rate limiting middleware. Returns 429 if a client exceeds 100 req/s (burst 200).
async fn rate_limit_mw(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    axum::extract::State(limiter): axum::extract::State<IpLimiter>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    match limiter.check_key(&addr.ip()) {
        Ok(_) => next.run(req).await,
        Err(_) => (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            [("Retry-After", "1")],
            "rate limit exceeded",
        ).into_response(),
    }
}

pub fn router(state: AppState) -> Router {
    let quota = Quota::per_second(NonZeroU32::new(100).unwrap()).allow_burst(NonZeroU32::new(200).unwrap());
    let limiter: IpLimiter = Arc::new(RateLimiter::keyed(quota));
    // Protected routes — require valid JWT
    let protected = Router::new()
        .route("/api/v1/whoami", get(whoami))
        .route("/api/v1/matrix", get(get_matrix).put(put_matrix))
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
        .route("/api/v1/outputs/:ch/dither", put(put_output_dither))
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
        .route("/api/v1/system/config/backups", get(get_config_backups))
        .route("/api/v1/system/config/backups/:name", get(get_config_backup))
        .route("/api/v1/system/config/backups/:name/restore", post(restore_config_backup))
        .route("/api/v1/admin/channels", post(post_admin_channels))
        .route("/api/v1/admin/restart", post(post_admin_restart))
        // Sprint E — Internal buses
        .route("/api/v1/buses", get(get_buses).post(post_bus))
        .route("/api/v1/buses/:id", get(get_bus).put(put_bus).delete(delete_bus))
        .route("/api/v1/buses/:id/gain", put(put_bus_gain))
        .route("/api/v1/buses/:id/polarity", put(put_bus_polarity))
        .route("/api/v1/buses/:id/hpf", put(put_bus_hpf))
        .route("/api/v1/buses/:id/lpf", put(put_bus_lpf))
        .route("/api/v1/buses/:id/eq", put(put_bus_eq))
        .route("/api/v1/buses/:id/eq/enabled", put(put_bus_eq_enabled))
        .route("/api/v1/buses/:id/gate", put(put_bus_gate))
        .route("/api/v1/buses/:id/compressor", put(put_bus_compressor))
        .route("/api/v1/buses/:id/mute", put(put_bus_mute))
        .route("/api/v1/buses/:id/routing", put(put_bus_routing))
        .route("/api/v1/buses/:id/input-gain", put(put_bus_input_gain))
        .route("/api/v1/bus-matrix", put(put_bus_matrix))
        .route("/api/v1/solo", get(get_solo).put(put_solo).delete(delete_solo))
        .route("/api/v1/solo/toggle/:rx", post(toggle_solo))
        .route("/api/v1/system/monitor", get(get_monitor).put(put_monitor))
        .route("/api/v1/system/audio-devices", get(list_audio_devices))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_api::require_auth));

    // Public routes — no auth required
    let mut app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/v1/health", get(get_health))
        .route("/api/v1/login", post(auth_api::login))
        .route("/api/v1/auth/refresh", post(auth_api::refresh_token))
        .route("/api/v1/config", get(get_config))
        .merge(protected);

    if let Ok(dev_dir) = std::env::var("PATCHBOX_DEV_ASSETS") {
        tracing::warn!("⚡ DEV MODE: serving assets from disk at {dev_dir}");
        app = app.fallback(move |req: axum::extract::Request| {
            let dir = dev_dir.clone();
            async move { dev_asset(dir, req).await }
        });
    } else {
        app = app
            .route("/", get(serve_ui))
            .fallback(|req: axum::extract::Request| async move {
                let path = req.uri().path().trim_start_matches('/').to_string();
                serve_asset(&path)
            });
    }

    app.with_state(state)
        .route_layer(middleware::from_fn_with_state(limiter, rate_limit_mw))
}
