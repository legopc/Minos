use axum::{
    middleware,
    extract::{Path, State, WebSocketUpgrade, ws::{WebSocket, Message}},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, put, post, delete},
    Json, Router,
};
use serde::{Deserialize, Serialize};
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
pub struct SaveSceneRequest { pub name: String, pub description: Option<String> }

#[derive(Serialize)]
pub struct HealthResponse { status: &'static str, rx_channels: usize, tx_channels: usize, version: &'static str }

#[derive(Serialize)]
pub struct MeterFrame { pub tx_rms: Vec<f32>, pub rx_rms: Vec<f32> }

// GET /api/v1/config
async fn get_config(State(s): State<AppState>) -> impl IntoResponse {
    Json(s.config.read().await.clone())
}

// PUT /api/v1/matrix
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

// GET /api/v1/health
async fn get_health(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(HealthResponse { status: "ok", rx_channels: cfg.rx_channels, tx_channels: cfg.tx_channels, version: env!("CARGO_PKG_VERSION") })
}

// GET /api/v1/scenes
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

// GET /ws
async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, s))
}

async fn handle_ws(mut socket: WebSocket, s: AppState) {
    let mut tick = interval(Duration::from_millis(50));
    loop {
        tick.tick().await;
        let meters = s.meters.read().await;
        let frame = MeterFrame { tx_rms: meters.tx_rms.clone(), rx_rms: meters.rx_rms.clone() };
        drop(meters);
        let json = match serde_json::to_string(&frame) { Ok(j) => j, Err(_) => continue };
        if socket.send(Message::Text(json.into())).await.is_err() { break; }
    }
}

// UI
async fn serve_ui() -> impl IntoResponse { Html(include_str!("../../../web/src/index.html")) }
async fn serve_zone_ui() -> impl IntoResponse { Html(include_str!("../../../web/src/zone.html")) }


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


#[derive(Deserialize)]
pub struct NameUpdate { pub name: String }

async fn put_source_name(
    State(s): State<AppState>,
    Path(idx): Path<usize>,
    Json(u): Json<NameUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if idx >= cfg.rx_channels { return (StatusCode::BAD_REQUEST, "out of range").into_response(); }
    cfg.sources[idx] = u.name;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

async fn put_zone_name(
    State(s): State<AppState>,
    Path(idx): Path<usize>,
    Json(u): Json<NameUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if idx >= cfg.tx_channels { return (StatusCode::BAD_REQUEST, "out of range").into_response(); }
    cfg.zones[idx] = u.name;
    drop(cfg);
    let _ = s.persist().await;
    StatusCode::OK.into_response()
}

pub fn router(state: AppState) -> Router {
    // Protected routes — require valid JWT
    let protected = Router::new()
        .route("/api/v1/whoami", get(whoami))
        .route("/api/v1/matrix", put(put_matrix))
        .route("/api/v1/gain/input", put(put_gain_input))
        .route("/api/v1/gain/output", put(put_gain_output))
        .route("/api/v1/zones/{tx}/mute", post(mute_zone))
        .route("/api/v1/zones/{tx}/unmute", post(unmute_zone))
        .route("/api/v1/mute-all", post(mute_all))
        .route("/api/v1/unmute-all", post(unmute_all))
        .route("/api/v1/scenes", get(list_scenes).post(save_scene))
        .route("/api/v1/scenes/{name}/load", post(load_scene))
        .route("/api/v1/scenes/{name}", delete(delete_scene))
        .route("/api/v1/sources/{idx}/name", put(put_source_name))
        .route("/api/v1/zones/{idx}/name", put(put_zone_name))
        .layer(middleware::from_fn_with_state(state.clone(), auth_api::require_auth));

    // Public routes — no auth required
    Router::new()
        .route("/", get(serve_ui))
        .route("/zone/{name}", get(serve_zone_ui))
        .route("/ws", get(ws_handler))
        .route("/api/v1/health", get(get_health))
        .route("/api/v1/login", post(auth_api::login))
        .route("/api/v1/config", get(get_config))
        .merge(protected)
        .with_state(state)
}
