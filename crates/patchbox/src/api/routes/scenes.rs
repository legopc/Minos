use crate::api::ws_broadcast;
use crate::scenes::Scene;
use crate::state::{AppState, EventActor, EventResource, TaskEvent, TaskStatus};
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use tokio::time::Duration;
use tracing;

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct SaveSceneRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct UpdateSceneRequest {
    name: Option<String>,
    description: Option<String>,
    is_favourite: Option<bool>,
}

// GET /api/v1/scenes
#[utoipa::path(
    get,
    path = "/api/v1/scenes",
    tag = "scenes",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of scenes"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn list_scenes(State(s): State<AppState>) -> impl IntoResponse {
    let store = s.scenes.read().await;
    let list: Vec<&Scene> = store.scenes.values().collect();
    Json(serde_json::json!({ "scenes": list, "active": store.active }))
}

// POST /api/v1/scenes
#[utoipa::path(
    post,
    path = "/api/v1/scenes",
    tag = "scenes",
    security(("bearer_auth" = [])),
    request_body = SaveSceneRequest,
    responses(
        (status = 200, description = "Scene saved"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn save_scene(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(req): Json<SaveSceneRequest>,
) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let description = req.description.clone();
    let scene = Scene::from_config(&req.name, &cfg, description.clone());
    drop(cfg);
    let mut store = s.scenes.write().await;
    let replaced_existing = store.scenes.insert(req.name.clone(), scene).is_some();
    drop(store);
    crate::persist_scenes_or_500!(s);
    s.push_audit_log(
        "scene.save",
        format!("Saved scene {}.", req.name),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "scene",
            Some(req.name.clone()),
            Some(req.name.clone()),
        )),
        Some(serde_json::json!({
            "description": description,
            "replaced_existing": replaced_existing,
        })),
    )
    .await;
    StatusCode::OK.into_response()
}

// POST /api/v1/scenes/:name/load
#[utoipa::path(
    post,
    path = "/api/v1/scenes/{name}/load",
    tag = "scenes",
    security(("bearer_auth" = [])),
    params(("name" = String, Path, description = "Scene name")),
    responses(
        (status = 200, description = "Scene loaded"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 404, description = "Scene not found")
    )
)]
#[tracing::instrument(skip_all, fields(scene_name = %name))]
pub async fn load_scene(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let task_id = format!("scene:load:{name}");
    s.emit_task_event(TaskEvent::new(
        task_id.clone(),
        TaskStatus::Started,
        "Loading scene",
        None,
        Some("scene.load".to_string()),
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "scene",
            Some(name.clone()),
            Some(name.clone()),
        )),
        None,
    ));
    let store = s.scenes.read().await;
    let scene = match store.scenes.get(&name) {
        Some(sc) => sc.clone(),
        None => {
            s.emit_task_event(TaskEvent::new(
                task_id,
                TaskStatus::Failed,
                "Loading scene",
                Some("Scene not found.".to_string()),
                Some("scene.load".to_string()),
                claims
                    .as_ref()
                    .map(|Extension(claims)| EventActor::from_claims(claims)),
                Some(EventResource::new(
                    "scene",
                    Some(name.clone()),
                    Some(name.clone()),
                )),
                None,
            ));
            return (StatusCode::NOT_FOUND, "scene not found").into_response();
        }
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

    s.push_audit_log(
        "scene.load",
        format!("Loaded scene {name}."),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "scene",
            Some(name.clone()),
            Some(name.clone()),
        )),
        Some(serde_json::json!({
            "crossfade_ms": crossfade_ms,
        })),
    )
    .await;
    s.emit_task_event(TaskEvent::new(
        task_id,
        TaskStatus::Succeeded,
        "Loading scene",
        Some(format!("Loaded scene {name}.")),
        Some("scene.load".to_string()),
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "scene",
            Some(name.clone()),
            Some(name.clone()),
        )),
        Some(serde_json::json!({ "crossfade_ms": crossfade_ms })),
    ));
    StatusCode::OK.into_response()
}

// DELETE /api/v1/scenes/:name
pub async fn delete_scene(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let mut store = s.scenes.write().await;
    if store.scenes.remove(&name).is_none() {
        return (StatusCode::NOT_FOUND, "scene not found").into_response();
    }
    if store.active.as_deref() == Some(&name) {
        store.active = None;
    }
    drop(store);
    crate::persist_scenes_or_500!(s);
    s.push_audit_log(
        "scene.delete",
        format!("Deleted scene {name}."),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "scene",
            Some(name.clone()),
            Some(name.clone()),
        )),
        None,
    )
    .await;
    StatusCode::OK.into_response()
}

// GET /api/v1/scenes/:id
pub async fn get_scene_by_id(
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
pub async fn put_scene(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSceneRequest>,
) -> impl IntoResponse {
    let mut store = s.scenes.write().await;
    let actor = claims
        .as_ref()
        .map(|Extension(claims)| EventActor::from_claims(claims));
    let requested_name = body.name.clone();
    let requested_description = body.description.clone();
    let requested_favourite = body.is_favourite;

    // Rename requires re-keying the HashMap; handle it by moving the scene.
    if let Some(new_id) = requested_name.clone() {
        if new_id != id {
            if store.scenes.contains_key(&new_id) {
                return StatusCode::CONFLICT.into_response();
            }
            let Some(mut scene) = store.scenes.remove(&id) else {
                return StatusCode::NOT_FOUND.into_response();
            };
            scene.name = new_id.clone();
            if let Some(desc) = requested_description.clone() {
                scene.description = Some(desc);
            }
            if let Some(fav) = requested_favourite {
                scene.is_favourite = fav;
            }
            if store.active.as_deref() == Some(&id) {
                store.active = Some(new_id.clone());
            }
            store.scenes.insert(new_id, scene);
            drop(store);
            crate::persist_scenes_or_500!(s);
            s.push_audit_log(
                "scene.update",
                format!("Renamed scene {id}."),
                None,
                actor,
                Some(EventResource::new(
                    "scene",
                    Some(id.clone()),
                    Some(id.clone()),
                )),
                Some(serde_json::json!({
                    "name": requested_name,
                    "description": requested_description,
                    "is_favourite": requested_favourite,
                })),
            )
            .await;
            return StatusCode::NO_CONTENT.into_response();
        }
    }

    let Some(scene) = store.scenes.get_mut(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(desc) = requested_description.clone() {
        scene.description = Some(desc);
    }
    if let Some(fav) = requested_favourite {
        scene.is_favourite = fav;
    }
    drop(store);
    crate::persist_scenes_or_500!(s);
    s.push_audit_log(
        "scene.update",
        format!("Updated scene {id}."),
        None,
        actor,
        Some(EventResource::new(
            "scene",
            Some(id.clone()),
            Some(id.clone()),
        )),
        Some(serde_json::json!({
            "description": requested_description,
            "is_favourite": requested_favourite,
        })),
    )
    .await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/scenes/:id/diff
pub async fn get_scene_diff(
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
