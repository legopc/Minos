use crate::ab_compare::{AbCompareState, AbSlot, AbSlotData, MorphDirection, MorphState};
use crate::api::ws_broadcast;
use crate::auth_api;
use crate::morph;
use crate::scenes::{RecallScope, Scene};
use crate::state::{AppState, EventActor, EventResource, TaskEvent, TaskStatus};
use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::collections::BTreeMap;
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

#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema, Default)]
pub struct LoadSceneRequest {
    #[serde(default)]
    pub scope: RecallScope,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct AbSlotQuery {
    pub slot: String,
}

#[derive(serde::Deserialize, utoipa::ToSchema, Default)]
pub struct CaptureAbSlotRequest {
    pub source: Option<String>,
    pub name: Option<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AbSlotSummaryResponse {
    pub source: String,
    pub captured_at_ms: i64,
    pub scene_name: String,
    pub schema_version: u32,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AbStateResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_a: Option<AbSlotSummaryResponse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_b: Option<AbSlotSummaryResponse>,
    pub active: AbSlot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub morph: Option<MorphState>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AbCaptureResponse {
    pub slot: AbSlot,
    pub source: String,
    pub captured_at_ms: i64,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AbToggleResponse {
    pub active: AbSlot,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct AbMorphRequest {
    pub direction: MorphDirection,
    pub duration_ms: u32,
    #[serde(default)]
    pub scope: RecallScope,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AbMorphResponse {
    pub ok: bool,
    pub active_target: AbSlot,
    pub duration_ms: u32,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AbMorphCancelResponse {
    pub cancelled_at_t: f32,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct SaveAbSlotRequest {
    pub name: String,
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
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot save scenes.",
    ) {
        return response;
    }
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
    body: Option<Json<LoadSceneRequest>>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot load scenes.",
    ) {
        return response;
    }
    let recall_scope = body.map(|Json(req)| req.scope).unwrap_or_default();
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
        Some(serde_json::json!({
            "scope": &recall_scope,
            "partial_recall": !recall_scope.is_full(),
        })),
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
        scene.apply_to_config_scoped(&mut cfg, &recall_scope);
    }

    s.scenes.write().await.active = Some(name.clone());
    crate::persist_or_500!(s);
    crate::persist_scenes_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({
            "type":"scene_loaded",
            "scene_id":&name,
            "name":&name,
            "scope": &recall_scope,
            "partial_recall": !recall_scope.is_full(),
        })
        .to_string(),
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
            "scope": &recall_scope,
            "partial_recall": !recall_scope.is_full(),
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
        Some(serde_json::json!({
            "crossfade_ms": crossfade_ms,
            "scope": &recall_scope,
            "partial_recall": !recall_scope.is_full(),
        })),
    ));
    StatusCode::OK.into_response()
}

// DELETE /api/v1/scenes/:name
pub async fn delete_scene(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot delete scenes.",
    ) {
        return response;
    }
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
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot edit scenes.",
    ) {
        return response;
    }
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

pub async fn get_ab_state(State(s): State<AppState>) -> impl IntoResponse {
    Json(ab_state_response(&s).await).into_response()
}

pub async fn capture_ab_slot(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Query(query): Query<AbSlotQuery>,
    body: Option<Json<CaptureAbSlotRequest>>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot manage scene A/B snapshots.",
    ) {
        return response;
    }
    let Ok(slot) = parse_ab_slot(&query.slot) else {
        return (StatusCode::BAD_REQUEST, "invalid slot").into_response();
    };
    let request = body.map(|Json(body)| body).unwrap_or_default();
    let source_kind = request.source.as_deref().unwrap_or("live");

    let snapshot = match source_kind {
        "live" => {
            let cfg = s.config.read().await;
            Scene::from_config(format!("slot_{}", slot.as_str()), &cfg, Some("A/B live capture".to_string()))
        }
        "scene" => {
            let Some(name) = request.name.as_deref() else {
                return (StatusCode::BAD_REQUEST, "scene name required").into_response();
            };
            let store = s.scenes.read().await;
            let Some(scene) = store.scenes.get(name) else {
                return StatusCode::NOT_FOUND.into_response();
            };
            scene.clone()
        }
        _ => return (StatusCode::BAD_REQUEST, "invalid source").into_response(),
    };

    let captured_at_ms = chrono::Utc::now().timestamp_millis();
    let source = match source_kind {
        "scene" => request.name.unwrap_or_else(|| "scene".to_string()),
        _ => "live".to_string(),
    };
    {
        let mut ab = s.ab_state.write().await;
        ab.set_slot(
            slot,
            Some(AbSlotData {
                source: source.clone(),
                snapshot,
                captured_at_ms,
            }),
        );
    }
    broadcast_ab_update(&s).await;
    Json(AbCaptureResponse {
        slot,
        source,
        captured_at_ms,
    })
    .into_response()
}

pub async fn toggle_ab(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot manage scene A/B snapshots.",
    ) {
        return response;
    }
    cancel_morph_task(&s).await;
    let (target_slot, snapshot) = {
        let ab = s.ab_state.read().await;
        let target_slot = ab.active.other();
        let Some(snapshot) = ab.slot(target_slot).map(|slot| slot.snapshot.clone()) else {
            return (StatusCode::CONFLICT, "target slot is empty").into_response();
        };
        (target_slot, snapshot)
    };

    {
        let mut cfg = s.config.write().await;
        snapshot.apply_to_config_scoped(&mut cfg, &RecallScope::default());
    }
    crate::persist_or_500!(s);
    {
        let mut ab = s.ab_state.write().await;
        ab.active = target_slot;
        ab.morph = None;
    }
    broadcast_ab_update(&s).await;
    Json(AbToggleResponse { active: target_slot }).into_response()
}

pub async fn get_ab_diff(State(s): State<AppState>) -> impl IntoResponse {
    let (slot_a, slot_b) = {
        let ab = s.ab_state.read().await;
        let Some(slot_a) = ab.slot_a.as_ref().map(|slot| slot.snapshot.clone()) else {
            return (StatusCode::CONFLICT, "slot a is empty").into_response();
        };
        let Some(slot_b) = ab.slot_b.as_ref().map(|slot| slot.snapshot.clone()) else {
            return (StatusCode::CONFLICT, "slot b is empty").into_response();
        };
        (slot_a, slot_b)
    };
    let base = s.config.read().await.clone();
    let current = scene_as_candidate_config(&base, &slot_a, &RecallScope::default());
    let candidate = scene_as_candidate_config(&base, &slot_b, &RecallScope::default());
    let diff = build_scene_diff(
        &current,
        &candidate,
        slot_a.schema_version.max(slot_b.schema_version),
        &RecallScope::default(),
    );
    Json(serde_json::json!({
        "scene_id": "ab_compare",
        "scope": RecallScope::default(),
        "changes": diff.changes,
        "sections": diff.sections,
        "summary": diff.summary(),
        "has_changes": diff.has_changes(),
    }))
    .into_response()
}

pub async fn start_ab_morph(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(body): Json<AbMorphRequest>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot start scene morphs.",
    ) {
        return response;
    }
    cancel_morph_task(&s).await;
    let duration_ms = body.duration_ms.max(20);
    let target_slot = body.direction.target_slot();
    let to_scene = {
        let ab = s.ab_state.read().await;
        let Some(slot) = ab.slot(target_slot).map(|slot| slot.snapshot.clone()) else {
            return (StatusCode::CONFLICT, "target slot is empty").into_response();
        };
        slot
    };
    let from_scene = {
        let cfg = s.config.read().await;
        Scene::from_config("__morph_from", &cfg, Some("Morph source".to_string()))
    };

    {
        let mut ab = s.ab_state.write().await;
        ab.morph = Some(MorphState {
            direction: body.direction,
            duration_ms,
            elapsed_ms: 0,
            scope: body.scope.clone(),
        });
    }
    let task_state = s.clone();
    let handle = tokio::spawn(async move {
        morph::run_morph(task_state, from_scene, to_scene, body.direction, duration_ms, body.scope).await;
    });
    {
        let mut task = s.morph_task.lock().await;
        *task = Some(handle);
    }
    broadcast_ab_update(&s).await;
    Json(AbMorphResponse {
        ok: true,
        active_target: target_slot,
        duration_ms,
    })
    .into_response()
}

pub async fn cancel_ab_morph(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot cancel scene morphs.",
    ) {
        return response;
    }
    let cancelled_at_t = {
        let ab = s.ab_state.read().await;
        let Some(morph) = ab.morph.as_ref() else {
            return (StatusCode::CONFLICT, "no morph in progress").into_response();
        };
        if morph.duration_ms == 0 {
            0.0
        } else {
            (morph.elapsed_ms as f32 / morph.duration_ms as f32).clamp(0.0, 1.0)
        }
    };
    cancel_morph_task(&s).await;
    {
        let mut ab = s.ab_state.write().await;
        ab.morph = None;
    }
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({
            "type": "morph_cancelled",
            "t": cancelled_at_t,
        })
        .to_string(),
    );
    broadcast_ab_update(&s).await;
    Json(AbMorphCancelResponse { cancelled_at_t }).into_response()
}

pub async fn save_ab_slot(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Query(query): Query<AbSlotQuery>,
    Json(body): Json<SaveAbSlotRequest>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot save A/B snapshots to the scene library.",
    ) {
        return response;
    }
    let Ok(slot) = parse_ab_slot(&query.slot) else {
        return (StatusCode::BAD_REQUEST, "invalid slot").into_response();
    };
    let snapshot = {
        let ab = s.ab_state.read().await;
        let Some(snapshot) = ab.slot(slot).map(|slot| slot.snapshot.clone()) else {
            return (StatusCode::CONFLICT, "slot is empty").into_response();
        };
        snapshot
    };
    let mut scene = snapshot;
    scene.name = body.name.clone();
    {
        let mut store = s.scenes.write().await;
        store.scenes.insert(scene.name.clone(), scene);
    }
    crate::persist_scenes_or_500!(s);
    StatusCode::OK.into_response()
}

// GET /api/v1/scenes/:id/diff
pub async fn get_scene_diff(
    State(s): State<AppState>,
    Path(id): Path<String>,
    scope: Option<Query<RecallScope>>,
) -> impl IntoResponse {
    let recall_scope = scope.map(|Query(scope)| scope).unwrap_or_default();
    let store = s.scenes.read().await;
    let Some(scene) = store.scenes.get(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let scene = scene.clone();
    drop(store);
    let current = s.config.read().await.clone();
    let mut candidate = current.clone();
    scene.apply_to_config_scoped(&mut candidate, &recall_scope);
    let diff = build_scene_diff(&current, &candidate, scene.schema_version, &recall_scope);
    Json(serde_json::json!({
        "scene_id": id,
        "schema_version": scene.schema_version,
        "scope": recall_scope,
        "changes": diff.changes,
        "sections": diff.sections,
        "summary": diff.summary(),
        "has_changes": diff.has_changes(),
    }))
    .into_response()
}

#[derive(Default)]
struct SceneDiff {
    changes: Vec<serde_json::Value>,
    sections: BTreeMap<String, SceneDiffSection>,
    total_changes: usize,
}

#[derive(Default, serde::Serialize)]
struct SceneDiffSection {
    label: String,
    count: usize,
    changes: Vec<serde_json::Value>,
}

impl SceneDiff {
    fn has_changes(&self) -> bool {
        !self.changes.is_empty()
    }

    fn summary(&self) -> serde_json::Value {
        let sections = self
            .sections
            .iter()
            .map(|(key, section)| {
                serde_json::json!({
                    "key": key,
                    "label": section.label,
                    "count": section.count,
                })
            })
            .collect::<Vec<_>>();
        serde_json::json!({
            "total_changes": self.total_changes,
            "section_count": self.sections.len(),
            "sections": sections,
        })
    }
}

fn scene_diff_kind(
    before: Option<&serde_json::Value>,
    after: Option<&serde_json::Value>,
) -> &'static str {
    match (before, after) {
        (None, Some(_)) => "added",
        (Some(_), None) => "removed",
        _ => "changed",
    }
}

fn record_scene_diff(
    diff: &mut SceneDiff,
    section_key: &str,
    section_label: &str,
    path: String,
    before: Option<&serde_json::Value>,
    after: Option<&serde_json::Value>,
) {
    diff.total_changes += 1;
    let field = if path.is_empty() {
        "<root>".to_string()
    } else {
        path
    };
    let flat_entry = serde_json::json!({
        "field": field,
        "scene": after.cloned().unwrap_or(serde_json::Value::Null),
        "current": before.cloned().unwrap_or(serde_json::Value::Null),
    });
    diff.changes.push(flat_entry.clone());
    let section = diff
        .sections
        .entry(section_key.to_string())
        .or_insert_with(|| SceneDiffSection {
            label: section_label.to_string(),
            count: 0,
            changes: Vec::new(),
        });
    section.count += 1;
    section.changes.push(serde_json::json!({
            "field": flat_entry.get("field").cloned().unwrap_or(serde_json::Value::Null),
            "kind": scene_diff_kind(before, after),
            "scene": flat_entry.get("scene").cloned().unwrap_or(serde_json::Value::Null),
            "current": flat_entry.get("current").cloned().unwrap_or(serde_json::Value::Null),
    }));
}

fn collect_scene_diff(
    diff: &mut SceneDiff,
    schema_version: u32,
    scope: &RecallScope,
    path: String,
    current: &serde_json::Value,
    candidate: &serde_json::Value,
) {
    if current == candidate {
        return;
    }

    match (current, candidate) {
        (serde_json::Value::Object(current_obj), serde_json::Value::Object(candidate_obj)) => {
            let mut keys: Vec<_> = current_obj
                .keys()
                .chain(candidate_obj.keys())
                .cloned()
                .collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                match (current_obj.get(&key), candidate_obj.get(&key)) {
                    (Some(before), Some(after)) => {
                        collect_scene_diff(diff, schema_version, scope, child_path, before, after);
                    }
                    (Some(before), None) => {
                        if let Some(section_key) =
                            scope.section_key_for_path(&child_path, schema_version)
                        {
                            record_scene_diff(
                                diff,
                                section_key,
                                RecallScope::section_label(section_key),
                                child_path,
                                Some(before),
                                None,
                            );
                        }
                    }
                    (None, Some(after)) => {
                        if let Some(section_key) =
                            scope.section_key_for_path(&child_path, schema_version)
                        {
                            record_scene_diff(
                                diff,
                                section_key,
                                RecallScope::section_label(section_key),
                                child_path,
                                None,
                                Some(after),
                            );
                        }
                    }
                    (None, None) => {}
                }
            }
        }
        (serde_json::Value::Array(current_arr), serde_json::Value::Array(candidate_arr)) => {
            let max_len = current_arr.len().max(candidate_arr.len());
            for idx in 0..max_len {
                let child_path = if path.is_empty() {
                    format!("[{idx}]")
                } else {
                    format!("{path}[{idx}]")
                };
                match (current_arr.get(idx), candidate_arr.get(idx)) {
                    (Some(before), Some(after)) => {
                        collect_scene_diff(diff, schema_version, scope, child_path, before, after);
                    }
                    (Some(before), None) => {
                        if let Some(section_key) =
                            scope.section_key_for_path(&child_path, schema_version)
                        {
                            record_scene_diff(
                                diff,
                                section_key,
                                RecallScope::section_label(section_key),
                                child_path,
                                Some(before),
                                None,
                            );
                        }
                    }
                    (None, Some(after)) => {
                        if let Some(section_key) =
                            scope.section_key_for_path(&child_path, schema_version)
                        {
                            record_scene_diff(
                                diff,
                                section_key,
                                RecallScope::section_label(section_key),
                                child_path,
                                None,
                                Some(after),
                            );
                        }
                    }
                    (None, None) => {}
                }
            }
        }
        _ => {
            if let Some(section_key) = scope.section_key_for_path(&path, schema_version) {
                record_scene_diff(
                    diff,
                    section_key,
                    RecallScope::section_label(section_key),
                    path,
                    Some(current),
                    Some(candidate),
                );
            }
        }
    }
}

fn build_scene_diff(
    current: &patchbox_core::config::PatchboxConfig,
    candidate: &patchbox_core::config::PatchboxConfig,
    schema_version: u32,
    scope: &RecallScope,
) -> SceneDiff {
    let current_json = serde_json::to_value(current).unwrap_or(serde_json::Value::Null);
    let candidate_json = serde_json::to_value(candidate).unwrap_or(serde_json::Value::Null);
    let mut diff = SceneDiff::default();
    collect_scene_diff(
        &mut diff,
        schema_version,
        scope,
        String::new(),
        &current_json,
        &candidate_json,
    );
    diff
}

fn parse_ab_slot(raw: &str) -> Result<AbSlot, ()> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "a" => Ok(AbSlot::A),
        "b" => Ok(AbSlot::B),
        _ => Err(()),
    }
}

fn scene_as_candidate_config(
    base: &patchbox_core::config::PatchboxConfig,
    scene: &Scene,
    scope: &RecallScope,
) -> patchbox_core::config::PatchboxConfig {
    let mut candidate = base.clone();
    scene.apply_to_config_scoped(&mut candidate, scope);
    candidate
}

fn slot_summary(slot: Option<&AbSlotData>) -> Option<AbSlotSummaryResponse> {
    slot.map(|slot| AbSlotSummaryResponse {
        source: slot.source.clone(),
        captured_at_ms: slot.captured_at_ms,
        scene_name: slot.snapshot.name.clone(),
        schema_version: slot.snapshot.schema_version,
    })
}

async fn ab_state_response(state: &AppState) -> AbStateResponse {
    let ab: AbCompareState = state.ab_state.read().await.clone();
    AbStateResponse {
        slot_a: slot_summary(ab.slot_a.as_ref()),
        slot_b: slot_summary(ab.slot_b.as_ref()),
        active: ab.active,
        morph: ab.morph,
    }
}

async fn broadcast_ab_update(state: &AppState) {
    ws_broadcast(state, morph::ab_state_event_payload(state).await.to_string());
}

async fn cancel_morph_task(state: &AppState) {
    let handle = {
        let mut task = state.morph_task.lock().await;
        task.take()
    };
    if let Some(handle) = handle {
        handle.abort();
    }
}
