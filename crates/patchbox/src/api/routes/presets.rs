use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

/// Body for saving a new preset.
#[derive(Deserialize)]
pub struct SavePresetBody {
    /// DSP block identifier, e.g. "cmp", "peq", "lim".
    pub block: String,
    /// Block parameters as a JSON object.
    pub params: serde_json::Value,
}

/// Query for delete (block type is required to disambiguate).
#[derive(Deserialize)]
pub struct BlockQuery {
    pub block: String,
}

#[derive(Serialize)]
pub struct RecallResponse {
    pub block: String,
    pub name: String,
    pub params: serde_json::Value,
}

/// GET /api/v1/presets — list all presets grouped by block type.
pub async fn list_presets(State(state): State<AppState>) -> impl IntoResponse {
    let lib = state.presets.read().await;
    Json(lib.blocks.clone())
}

/// POST /api/v1/presets/:name — save current DSP block params as a named preset.
pub async fn save_preset(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SavePresetBody>,
) -> impl IntoResponse {
    {
        let mut lib = state.presets.write().await;
        lib.insert(&body.block, &name, body.params);
    }
    let lib = state.presets.read().await;
    if let Err(e) = lib.save_to_file(&state.presets_path) {
        tracing::warn!(error = %e, "preset save to disk failed (changes in memory)");
    }
    StatusCode::CREATED
}

/// POST /api/v1/presets/:name/recall — return preset params so the client can apply them.
pub async fn recall_preset(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<BlockQuery>,
) -> impl IntoResponse {
    let lib = state.presets.read().await;
    match lib.get(&q.block, &name) {
        Some(params) => Json(RecallResponse {
            block: q.block.clone(),
            name: name.clone(),
            params: params.clone(),
        })
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "preset not found"})),
        )
            .into_response(),
    }
}

/// DELETE /api/v1/presets/:name?block=cmp — remove a named preset.
pub async fn delete_preset(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<BlockQuery>,
) -> impl IntoResponse {
    let removed = {
        let mut lib = state.presets.write().await;
        lib.remove(&q.block, &name)
    };
    if removed.is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "preset not found"})),
        )
            .into_response();
    }
    let lib = state.presets.read().await;
    if let Err(e) = lib.save_to_file(&state.presets_path) {
        tracing::warn!(error = %e, "preset save to disk failed (changes in memory)");
    }
    StatusCode::NO_CONTENT.into_response()
}
