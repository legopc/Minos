use crate::api::ws_broadcast;
use crate::scenes::Scene;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use tokio::time::Duration;
use tracing;

#[derive(serde::Deserialize)]
pub(crate) struct SaveSceneRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(serde::Deserialize)]
pub(crate) struct UpdateSceneRequest {
    name: Option<String>,
    description: Option<String>,
    is_favourite: Option<bool>,
}

// GET /api/v1/scenes
pub(crate) async fn list_scenes(State(s): State<AppState>) -> impl IntoResponse {
    let store = s.scenes.read().await;
    let list: Vec<&Scene> = store.scenes.values().collect();
    Json(serde_json::json!({ "scenes": list, "active": store.active }))
}

// POST /api/v1/scenes
pub(crate) async fn save_scene(
    State(s): State<AppState>,
    Json(req): Json<SaveSceneRequest>,
) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let scene = Scene::from_config(&req.name, &cfg, req.description);
    drop(cfg);
    let mut store = s.scenes.write().await;
    store.scenes.insert(req.name.clone(), scene);
    drop(store);
    crate::persist_scenes_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/scenes/:name/load
#[tracing::instrument(skip_all, fields(scene_name = %name))]
pub(crate) async fn load_scene(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let store = s.scenes.read().await;
    let scene = match store.scenes.get(&name) {
        Some(sc) => sc.clone(),
        None => return (StatusCode::NOT_FOUND, "scene not found").into_response(),
    };
    drop(store);

    let crossfade_ms = {
        let cfg = s.config.read().await;
        cfg.scene_crossfade_ms
    };

    {
        let mut cfg = s.config.write().await;
        if crossfade_ms > 0.0 {
            cfg.xp_ramp_ms = crossfade_ms;
        }
        scene.apply_to_config(&mut cfg);
    }

    s.scenes.write().await.active = Some(name.clone());
    crate::persist_or_500!(s);
    crate::persist_scenes_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"scene_loaded","scene_id":&name,"name":&name}).to_string(),
    );

    // Clear solo state on scene load
    {
        let mut cfg = s.config.write().await;
        cfg.solo_channels.clear();
        let monitor_device = cfg.monitor_device.clone();
        drop(cfg);
        ws_broadcast(
            &s,
            serde_json::json!({
                "type": "solo_update",
                "channels": Vec::<usize>::new(),
                "monitor_device": monitor_device,
            })
            .to_string(),
        );
    }

    // After crossfade completes, restore xp_ramp_ms to 0
    if crossfade_ms > 0.0 {
        let state = s.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis((crossfade_ms * 5.0) as u64)).await;
            let mut cfg = state.config.write().await;
            cfg.xp_ramp_ms = 0.0;
        });
    }

    StatusCode::OK.into_response()
}

// DELETE /api/v1/scenes/:name
pub(crate) async fn delete_scene(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let mut store = s.scenes.write().await;
    if store.scenes.remove(&name).is_none() {
        return (StatusCode::NOT_FOUND, "scene not found").into_response();
    }
    drop(store);
    crate::persist_scenes_or_500!(s);
    StatusCode::OK.into_response()
}

// GET /api/v1/scenes/:id
pub(crate) async fn get_scene_by_id(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let store = s.scenes.read().await;
    match store.scenes.get(&id) {
        Some(scene) => Json(scene.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/scenes/:id
pub(crate) async fn put_scene(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSceneRequest>,
) -> impl IntoResponse {
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
    crate::persist_scenes_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/scenes/:id/diff
pub(crate) async fn get_scene_diff(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
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
            let cv = cfg
                .matrix
                .get(tx)
                .and_then(|r| r.get(rx))
                .copied()
                .unwrap_or(false);
            if sv != cv {
                changes.push(serde_json::json!({"field": format!("matrix[{}][{}]", tx, rx), "scene": sv, "current": cv}));
            }
        }
    }
    for (i, (&sv, &cv)) in scene
        .input_gain_db
        .iter()
        .zip(cfg.input_gain_db.iter())
        .enumerate()
    {
        if (sv - cv).abs() > 0.01 {
            changes.push(serde_json::json!({"field": format!("input_gain_db[{}]", i), "scene": sv, "current": cv}));
        }
    }
    for (i, (&sv, &cv)) in scene
        .output_gain_db
        .iter()
        .zip(cfg.output_gain_db.iter())
        .enumerate()
    {
        if (sv - cv).abs() > 0.01 {
            changes.push(serde_json::json!({"field": format!("output_gain_db[{}]", i), "scene": sv, "current": cv}));
        }
    }
    Json(
        serde_json::json!({"scene_id": id, "changes": changes, "has_changes": !changes.is_empty()}),
    )
    .into_response()
}
