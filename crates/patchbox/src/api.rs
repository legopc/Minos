use axum::{
    extract::State,
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct MatrixUpdate {
    tx: usize,
    rx: usize,
    enabled: bool,
}

#[derive(Deserialize)]
pub struct GainUpdate {
    channel: usize,
    db: f32,
}

#[derive(Serialize)]
pub struct HealthResponse {
    status: &'static str,
    rx_channels: usize,
    tx_channels: usize,
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
        tracing::error!("failed to persist config: {}", e);
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
        tracing::error!("failed to persist config: {}", e);
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
        tracing::error!("failed to persist config: {}", e);
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
    })
}

// GET / — serve embedded web UI
async fn serve_ui() -> impl IntoResponse {
    Html(include_str!("../../../web/src/index.html"))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(serve_ui))
        .route("/api/v1/config", get(get_config))
        .route("/api/v1/matrix", put(put_matrix))
        .route("/api/v1/gain/input", put(put_gain_input))
        .route("/api/v1/gain/output", put(put_gain_output))
        .route("/api/v1/health", get(get_health))
        .with_state(state)
}
