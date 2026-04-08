use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use patchbox_core::scene;
use serde::{Deserialize, Serialize};

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
        .with_state(state)
}

// ── Health ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status:  &'static str,
    version: &'static str,
    inputs:  usize,
    outputs: usize,
}

async fn health(State(state): State<SharedState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status:  "ok",
        version: env!("CARGO_PKG_VERSION"),
        inputs:  state.config.n_inputs,
        outputs: state.config.n_outputs,
    })
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
    params.matrix.set(input, output, body.gain);
    StatusCode::NO_CONTENT.into_response()
}

// ── Channel strip controls ───────────────────────────────────────────────

#[derive(Deserialize)]
struct NameBody { name: String }

async fn set_input_name(
    State(state): State<SharedState>,
    Path(id): Path<usize>,
    Json(body): Json<NameBody>,
) -> impl IntoResponse {
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
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
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
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
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
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
