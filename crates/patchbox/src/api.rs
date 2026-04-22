use axum::extract::ConnectInfo;
use axum::http::Request;
use axum::middleware::Next;
use axum::{
    extract::{ws::WebSocket, State, WebSocketUpgrade},
    http::{header, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use governor::{clock::DefaultClock, state::keyed::DefaultKeyedStateStore, Quota, RateLimiter};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::net::{IpAddr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::Arc;
use tokio::time::interval;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

type IpLimiter = Arc<RateLimiter<IpAddr, DefaultKeyedStateStore<IpAddr>, DefaultClock>>;

#[derive(RustEmbed)]
#[folder = "../../web/src/"]
struct Assets;
#[derive(RustEmbed)]
#[folder = "../../docs/book/"]
struct DocsAssets;

async fn serve_docs(axum::extract::Path(path): axum::extract::Path<String>) -> Response {
    let path = path.trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match DocsAssets::get(path) {
        Some(content) => {
            let mime = path
                .rsplit('.')
                .next()
                .map(mime_for_ext)
                .unwrap_or("application/octet-stream");
            ([(header::CONTENT_TYPE, mime)], content.data.into_owned()).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_docs_index() -> Response {
    match DocsAssets::get("index.html") {
        Some(content) => (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            content.data.into_owned(),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn serve_asset(path: &str) -> Response {
    match Assets::get(path) {
        Some(content) => {
            let mime = match path.rsplit('.').next() {
                Some("css") => "text/css; charset=utf-8",
                Some("js") => "application/javascript; charset=utf-8",
                Some("html") => "text/html; charset=utf-8",
                _ => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, mime)], content.data.into_owned()).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

use crate::auth_api;
use crate::state::AppState;

pub mod atomic_write;
pub mod openapi;
pub mod routes;

use routes::buses::*;
use routes::inputs::*;
use routes::outputs::*;
use routes::presets::*;
use routes::routing::*;
use routes::scenes::*;
use routes::system::*;
use routes::zones::*;

use patchbox_core::config::DspChain;

#[derive(Serialize, utoipa::ToSchema)]
pub struct ErrorResponse {
    pub error: String,
    pub in_memory: Option<bool>,
}

/// Returns HTTP 500 with structured JSON if config persist fails.
/// The change remains live in memory until next restart (documented in response body).
#[macro_export]
macro_rules! persist_or_500 {
    ($state:expr) => {
        if let Err(e) = $state.persist().await {
            tracing::error!(error = %e, "config persist failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json($crate::api::ErrorResponse {
                    error: format!("persist failed: {e}"),
                    in_memory: Some(true),
                }),
            )
                .into_response();
        }
    };
}

#[macro_export]
macro_rules! persist_scenes_or_500 {
    ($state:expr) => {
        if let Err(e) = $state.persist_scenes().await {
            tracing::error!(error = %e, "scenes persist failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json($crate::api::ErrorResponse {
                    error: format!("scenes persist failed: {e}"),
                    in_memory: Some(true),
                }),
            )
                .into_response();
        }
    };
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct GainBody {
    pub gain_db: f32,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct EnabledBody {
    pub enabled: bool,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct MutedBody {
    pub muted: bool,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct PolarityBody {
    pub invert: bool,
}

pub fn parse_rx_id(id: &str) -> Option<usize> {
    id.strip_prefix("rx_")?.parse().ok()
}

pub fn parse_tx_id(id: &str) -> Option<usize> {
    id.strip_prefix("tx_")?.parse().ok()
}

pub fn parse_bus_id(id: &str) -> Option<usize> {
    id.strip_prefix("bus_")?.parse().ok()
}

pub fn parse_zone_id(id: &str) -> Option<u64> {
    id.strip_prefix("zone_")?.parse().ok()
}

pub fn parse_zone_template_id(id: &str) -> Option<u64> {
    id.strip_prefix("zone_template_")?.parse().ok()
}

pub fn dsp_to_value(dsp: &impl DspChain) -> serde_json::Value {
    dsp.to_dsp_value()
}

pub fn linear_to_dbfs(v: f32) -> f32 {
    if v <= 0.0 {
        return -60.0;
    }
    (20.0 * v.log10()).max(-60.0)
}

/// Send an event JSON string to all connected WS clients.
pub fn ws_broadcast(s: &AppState, msg: String) {
    let _ = s.ws_tx.send(msg);
}

// GET /api/v1/config
async fn get_config(State(s): State<AppState>) -> impl IntoResponse {
    Json(s.config.read().await.clone())
}

async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, s))
}

async fn ws_state_hash(s: &AppState) -> String {
    let cfg_json = {
        let cfg = s.config.read().await;
        serde_json::to_string(&*cfg).unwrap_or_default()
    };
    let scenes_json = {
        let scenes = s.scenes.read().await;
        serde_json::to_string(&*scenes).unwrap_or_default()
    };
    let mut hasher = DefaultHasher::new();
    cfg_json.hash(&mut hasher);
    scenes_json.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

async fn ws_state_payload(s: &AppState, msg_type: &str) -> serde_json::Value {
    let state_hash = ws_state_hash(s).await;
    let (rx_count, tx_count, zone_count, solo_channels, monitor_device, monitor_volume_db) = {
        let cfg = s.config.read().await;
        (
            cfg.rx_channels,
            cfg.tx_channels,
            cfg.zone_config.len(),
            cfg.solo_channels.clone(),
            cfg.monitor_device.clone(),
            cfg.monitor_volume_db,
        )
    };
    let active_scene_id = s.scenes.read().await.active.clone();
    serde_json::json!({
        "type": msg_type,
        "version": env!("CARGO_PKG_VERSION"),
        "state_hash": state_hash,
        "rx_count": rx_count,
        "tx_count": tx_count,
        "zone_count": zone_count,
        "solo_channels": solo_channels,
        "monitor_device": monitor_device,
        "monitor_volume_db": monitor_volume_db,
        "active_scene_id": active_scene_id,
    })
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
        let hello = ws_state_payload(&s, "hello").await;
        let _ = sender.send(Message::Text(hello.to_string())).await;
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
        let mut meter_tick = interval(Duration::from_millis(100));
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
                        if filter.as_ref().is_none_or(|f| f.contains(&id)) {
                            rx_map.insert(id, serde_json::json!(linear_to_dbfs(v)));
                        }
                    }
                    let mut tx_map = serde_json::Map::new();
                    for (i, &v) in meters.tx_rms.iter().enumerate() {
                        let id = format!("tx_{}", i);
                        if filter.as_ref().is_none_or(|f| f.contains(&id)) {
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
                        if filter.as_ref().is_none_or(|f| f.contains(&id)) {
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
                    let mut lufs_m_map = serde_json::Map::new();
                    let mut lufs_i_map = serde_json::Map::new();
                    for (i, &v) in meters.lufs_momentary.iter().enumerate() {
                        lufs_m_map.insert(format!("tx_{}", i), serde_json::json!(v));
                    }
                    for (i, &v) in meters.lufs_integrated.iter().enumerate() {
                        lufs_i_map.insert(format!("tx_{}", i), serde_json::json!(v));
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
                        "clip": clip_map,
                        "lufs_m": lufs_m_map,
                        "lufs_i": lufs_i_map
                    });
                    if sender.send(Message::Text(msg.to_string())).await.is_err() {
                        break;
                    }
                }
                result = rx.recv() => {
                    match result {
                        Ok(event) => {
                            if sender.send(Message::Text(event)).await.is_err() { break; }
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
                            Some("resync") => { /* client rehydrates from reconnect hello */ }
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

    let _ = cancel_tx.send(()); // signal send task if still running
    send_task.abort();
}

async fn serve_ui() -> impl IntoResponse {
    serve_asset("index.html")
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ico" => "image/x-icon",
        "png" => "image/png",
        "json" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
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
        )
            .into_response(),
    }
}

pub fn router(state: AppState) -> Router {
    let quota =
        Quota::per_second(NonZeroU32::new(100).unwrap()).allow_burst(NonZeroU32::new(200).unwrap());
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
        .route("/api/v1/scenes/ab", get(get_ab_state))
        .route("/api/v1/scenes/ab/capture", post(capture_ab_slot))
        .route("/api/v1/scenes/ab/toggle", post(toggle_ab))
        .route("/api/v1/scenes/ab/diff", get(get_ab_diff))
        .route("/api/v1/scenes/ab/morph", post(start_ab_morph))
        .route("/api/v1/scenes/ab/morph/cancel", post(cancel_ab_morph))
        .route("/api/v1/scenes/ab/save", post(save_ab_slot))
        .route("/api/v1/scenes/:name/load", post(load_scene))
        .route(
            "/api/v1/scenes/:name",
            get(get_scene_by_id).put(put_scene).delete(delete_scene),
        )
        .route("/api/v1/scenes/:name/diff", get(get_scene_diff))
        .route("/api/v1/sources/:idx/name", put(put_source_name))
        .route("/api/v1/zones/:idx/name", put(put_zone_name))
        .route("/api/v1/zones/:tx/eq", get(get_eq).put(put_eq))
        .route("/api/v1/zones/:tx/eq/enabled", put(put_eq_enabled))
        .route(
            "/api/v1/zones/:tx/limiter",
            get(get_limiter).put(put_limiter),
        )
        .route(
            "/api/v1/zones/:tx/limiter/enabled",
            put(put_limiter_enabled),
        )
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
        .route(
            "/api/v1/outputs/:id",
            get(get_output_resource).put(put_output_resource),
        )
        .route("/api/v1/zones", get(get_zones_list).post(post_zone))
        .route(
            "/api/v1/zones/templates",
            get(get_zone_templates).post(post_zone_template),
        )
        .route("/api/v1/zones/metering", get(get_zone_metering))
        .route(
            "/api/v1/zones/:zone_id",
            put(put_zone_resource).delete(delete_zone_resource),
        )
        .route(
            "/api/v1/zones/templates/:template_id",
            delete(delete_zone_template),
        )
        .route(
            "/api/v1/routes",
            get(get_routes).post(post_route).delete(delete_routes_bulk),
        )
        .route("/api/v1/routes/trace", get(get_route_trace))
        .route("/api/v1/routes/:id", delete(delete_route))
        .route("/api/v1/bulk", post(post_bulk_mutation))
        .route("/api/v1/batch-update", post(post_batch_update))
        .route("/api/v1/system/log-level", put(put_log_level))
        .route("/api/v1/metering", get(get_metering))
        .route("/api/v1/system", get(get_system))
        .route("/api/v1/system/audit", get(get_audit_log))
        .route("/api/v1/system/audit/export", get(export_audit_log))
        .route(
            "/api/v1/system/dante/diagnostics",
            get(get_dante_diagnostics),
        )
        .route(
            "/api/v1/system/dante/recovery-actions/:action",
            post(post_dante_recovery_action),
        )
        .route("/api/v1/system/config", put(put_system_config))
        .route(
            "/api/v1/system/config/export",
            get(get_system_config_export),
        )
        .route(
            "/api/v1/system/config/import",
            post(post_system_config_import),
        )
        .route("/api/v1/system/config/validate", post(post_config_validate))
        .route(
            "/api/v1/system/config/backup",
            get(get_config_backup_download),
        )
        .route("/api/v1/system/config/restore", post(post_config_restore))
        .route("/api/v1/system/config/backups", get(get_config_backups))
        .route(
            "/api/v1/system/config/backups/:name",
            get(get_config_backup),
        )
        .route(
            "/api/v1/system/config/backups/:name/restore",
            post(restore_config_backup),
        )
        .route("/api/v1/admin/channels", post(post_admin_channels))
        .route("/api/v1/admin/restart", post(post_admin_restart))
        // Sprint E — Internal buses
        .route("/api/v1/buses", get(get_buses).post(post_bus))
        .route(
            "/api/v1/buses/:id",
            get(get_bus).put(put_bus).delete(delete_bus),
        )
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
        .route("/api/v1/bus-feed-matrix", get(get_bus_feed_matrix))
        .route("/api/v1/bus-feed", put(put_bus_feed))
        .route(
            "/api/v1/vca-groups",
            get(get_vca_groups).post(post_vca_group),
        )
        .route(
            "/api/v1/vca-groups/:id",
            put(put_vca_group).delete(delete_vca_group),
        )
        .route(
            "/api/v1/automixer-groups",
            get(get_automixer_groups).post(post_automixer_group),
        )
        .route(
            "/api/v1/automixer-groups/:id",
            put(put_automixer_group).delete(delete_automixer_group),
        )
        .route(
            "/api/v1/signal-generators",
            get(get_signal_generators).post(post_signal_generator),
        )
        .route(
            "/api/v1/signal-generators/:id",
            put(put_signal_generator).delete(delete_signal_generator),
        )
        .route(
            "/api/v1/signal-generators/:id/routing",
            get(get_generator_routing).put(put_generator_routing),
        )
        .route(
            "/api/v1/stereo-links",
            get(get_stereo_links).post(post_stereo_link),
        )
        .route(
            "/api/v1/stereo-links/:left_ch",
            put(put_stereo_link).delete(delete_stereo_link),
        )
        .route(
            "/api/v1/output-stereo-links",
            get(get_output_stereo_links).post(post_output_stereo_link),
        )
        .route(
            "/api/v1/output-stereo-links/:left_ch",
            put(put_output_stereo_link).delete(delete_output_stereo_link),
        )
        .route(
            "/api/v1/inputs/:ch/aec",
            get(get_input_aec).put(put_input_aec),
        )
        .route("/api/v1/inputs/:ch/automixer", put(put_input_automixer))
        .route(
            "/api/v1/inputs/:ch/feedback",
            get(get_input_feedback).put(put_input_feedback),
        )
        .route(
            "/api/v1/inputs/:ch/deq",
            get(get_input_deq).put(put_input_deq),
        )
        .route(
            "/api/v1/outputs/:ch/deq",
            get(get_output_deq).put(put_output_deq),
        )
        .route(
            "/api/v1/outputs/:ch/dsp/ducker",
            get(get_output_ducker).put(put_output_ducker),
        )
        .route("/api/v1/outputs/:ch/dsp/lufs", get(get_output_lufs))
        .route(
            "/api/v1/solo",
            get(get_solo).put(put_solo).delete(delete_solo),
        )
        .route("/api/v1/solo/toggle/:rx", post(toggle_solo))
        .route("/api/v1/system/monitor", get(get_monitor).put(put_monitor))
        .route("/api/v1/system/audio-devices", get(list_audio_devices))
        // Preset library
        .route("/api/v1/presets", get(list_presets))
        .route("/api/v1/presets/:name", post(save_preset).delete(delete_preset))
        .route("/api/v1/presets/:name/recall", post(recall_preset))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_api::require_auth,
        ));

    // Public routes — no auth required
    let mut app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/v1/health", get(get_health))
        .route("/api/v1/metrics", get(get_metrics))
        .route("/api/v1/metrics/prometheus", get(get_metrics_prometheus))
        .route("/api/v1/login", post(auth_api::login))
        .route("/api/v1/auth/refresh", post(auth_api::refresh_token))
        .route("/api/v1/config", get(get_config))
        .route("/docs", get(serve_docs_index))
        .route("/docs/", get(serve_docs_index))
        .route("/docs/*path", get(serve_docs))
        .merge(protected);

    // OpenAPI spec and interactive docs (public, no auth required)
    app = app
        .route(
            "/api/openapi.json",
            get(|| async { axum::response::Redirect::permanent("/api/v1/openapi.json") }),
        )
        .route(
            "/api/docs",
            get(|| async { axum::response::Redirect::permanent("/api/v1/docs") }),
        )
        .route(
            "/api/docs/",
            get(|| async { axum::response::Redirect::permanent("/api/v1/docs/") }),
        )
        .merge(Router::from(SwaggerUi::new("/api/v1/docs").url(
            "/api/v1/openapi.json",
            crate::openapi::ApiDoc::openapi(),
        )));

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
