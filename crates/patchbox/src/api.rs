use axum::{
    extract::{State, WebSocketUpgrade, ws::{WebSocket, Message}},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use crate::state::AppState;
use std::time::Duration;
use tokio::time::interval;

#[derive(Deserialize)]
pub struct MatrixUpdate {
    pub tx: usize,
    pub rx: usize,
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct GainUpdate {
    pub channel: usize,
    pub db: f32,
}

#[derive(Serialize)]
pub struct HealthResponse {
    status: &'static str,
    rx_channels: usize,
    tx_channels: usize,
    version: &'static str,
}

#[derive(Serialize)]
pub struct MeterFrame {
    /// RMS levels per TX output channel (linear 0.0–1.0)
    pub tx_rms: Vec<f32>,
    /// RMS levels per RX input channel (linear 0.0–1.0)
    pub rx_rms: Vec<f32>,
}

// GET /api/v1/config
async fn get_config(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    Json(cfg.clone())
}

// PUT /api/v1/matrix
async fn put_matrix(
    State(state): State<AppState>,
    Json(update): Json<MatrixUpdate>,
) -> impl IntoResponse {
    let mut cfg = state.config.write().await;
    if update.tx >= cfg.tx_channels || update.rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "channel index out of range").into_response();
    }
    cfg.matrix[update.tx][update.rx] = update.enabled;
    drop(cfg);
    if let Err(e) = state.persist().await {
        tracing::error!("persist failed: {}", e);
    }
    StatusCode::OK.into_response()
}

// PUT /api/v1/gain/input
async fn put_gain_input(
    State(state): State<AppState>,
    Json(update): Json<GainUpdate>,
) -> impl IntoResponse {
    let mut cfg = state.config.write().await;
    if update.channel >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "channel index out of range").into_response();
    }
    cfg.input_gain_db[update.channel] = update.db.clamp(-60.0, 12.0);
    drop(cfg);
    if let Err(e) = state.persist().await {
        tracing::error!("persist failed: {}", e);
    }
    StatusCode::OK.into_response()
}

// PUT /api/v1/gain/output
async fn put_gain_output(
    State(state): State<AppState>,
    Json(update): Json<GainUpdate>,
) -> impl IntoResponse {
    let mut cfg = state.config.write().await;
    if update.channel >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "channel index out of range").into_response();
    }
    cfg.output_gain_db[update.channel] = update.db.clamp(-60.0, 12.0);
    drop(cfg);
    if let Err(e) = state.persist().await {
        tracing::error!("persist failed: {}", e);
    }
    StatusCode::OK.into_response()
}

// GET /api/v1/health
async fn get_health(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    Json(HealthResponse {
        status: "ok",
        rx_channels: cfg.rx_channels,
        tx_channels: cfg.tx_channels,
        version: env!("CARGO_PKG_VERSION"),
    })
}

// GET /ws — WebSocket metering
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: AppState) {
    let mut tick = interval(Duration::from_millis(50)); // 20fps
    loop {
        tick.tick().await;
        // Read current meters from state
        let meters = state.meters.read().await;
        let frame = MeterFrame {
            tx_rms: meters.tx_rms.clone(),
            rx_rms: meters.rx_rms.clone(),
        };
        drop(meters);
        let json = match serde_json::to_string(&frame) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if socket.send(Message::Text(json.into())).await.is_err() {
            break; // client disconnected
        }
    }
}

// GET / — full admin UI
async fn serve_ui() -> impl IntoResponse {
    Html(include_str!("../../../web/src/index.html"))
}

// GET /zone/:name — zone-scoped UI
async fn serve_zone_ui() -> impl IntoResponse {
    Html(include_str!("../../../web/src/zone.html"))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(serve_ui))
        .route("/zone/{name}", get(serve_zone_ui))
        .route("/ws", get(ws_handler))
        .route("/api/v1/config", get(get_config))
        .route("/api/v1/matrix", put(put_matrix))
        .route("/api/v1/gain/input", put(put_gain_input))
        .route("/api/v1/gain/output", put(put_gain_output))
        .route("/api/v1/health", get(get_health))
        .with_state(state)
}
