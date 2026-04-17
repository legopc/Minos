use crate::api::parse_zone_id;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use patchbox_core::config::ZoneConfig;
use tracing;

#[derive(serde::Deserialize)]
pub struct NameUpdate {
    pub name: String,
}

#[derive(serde::Deserialize)]
pub struct EqUpdate {
    pub band: usize,
    pub freq_hz: f32,
    pub gain_db: f32,
    pub q: f32,
}

#[derive(serde::Deserialize)]
pub struct EqEnabledUpdate {
    pub enabled: bool,
}

#[derive(serde::Deserialize)]
pub struct LimiterUpdate {
    pub threshold_db: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
}

#[derive(serde::Deserialize)]
pub struct LimiterEnabledUpdate {
    pub enabled: bool,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct CreateZoneRequest {
    name: String,
    colour_index: Option<u8>,
    tx_ids: Option<Vec<String>>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct UpdateZoneRequest {
    name: Option<String>,
    colour_index: Option<u8>,
    tx_ids: Option<Vec<String>>,
}

// POST /api/v1/zones/:tx/mute
pub async fn mute_zone(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "zone out of range").into_response();
    }
    cfg.output_muted[tx] = true;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/zones/:tx/unmute
pub async fn unmute_zone(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "zone out of range").into_response();
    }
    cfg.output_muted[tx] = false;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/mute-all
pub async fn mute_all(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() {
        *m = true;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/unmute-all
pub async fn unmute_all(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() {
        *m = false;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// GET /api/v1/zones
#[utoipa::path(
    get,
    path = "/api/v1/zones",
    tag = "zones",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of zones"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_zones_list(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(cfg.zone_config.clone())
}

// POST /api/v1/zones
#[utoipa::path(
    post,
    path = "/api/v1/zones",
    tag = "zones",
    security(("bearer_auth" = [])),
    request_body = CreateZoneRequest,
    responses(
        (status = 201, description = "Zone created"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn post_zone(
    State(s): State<AppState>,
    Json(body): Json<CreateZoneRequest>,
) -> impl IntoResponse {
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
    crate::persist_or_500!(s);
    (StatusCode::CREATED, Json(zone)).into_response()
}

// PUT /api/v1/zones/:zone_id
#[utoipa::path(
    put,
    path = "/api/v1/zones/{zone_id}",
    tag = "zones",
    security(("bearer_auth" = [])),
    params(("zone_id" = String, Path, description = "Zone ID")),
    request_body = UpdateZoneRequest,
    responses(
        (status = 204, description = "Updated"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
#[tracing::instrument(skip_all, fields(zone_id))]
pub async fn put_zone_resource(
    State(s): State<AppState>,
    Path(zone_id): Path<String>,
    Json(body): Json<UpdateZoneRequest>,
) -> impl IntoResponse {
    let Some(i) = parse_zone_id(&zone_id) else {
        return (StatusCode::BAD_REQUEST, "invalid zone id (expected zone_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.zone_config.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(name) = body.name {
        if i < cfg.zones.len() {
            cfg.zones[i] = name.clone();
        }
        cfg.zone_config[i].name = name;
    }
    if let Some(ci) = body.colour_index {
        cfg.zone_config[i].colour_index = ci;
    }
    if let Some(tx_ids) = body.tx_ids {
        cfg.zone_config[i].tx_ids = tx_ids;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/zones/:zone_id
#[utoipa::path(
    delete,
    path = "/api/v1/zones/{zone_id}",
    tag = "zones",
    security(("bearer_auth" = [])),
    params(("zone_id" = String, Path, description = "Zone ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn delete_zone_resource(
    State(s): State<AppState>,
    Path(zone_id): Path<String>,
) -> impl IntoResponse {
    let Some(i) = parse_zone_id(&zone_id) else {
        return (StatusCode::BAD_REQUEST, "invalid zone id (expected zone_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.zone_config.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    cfg.zone_config.remove(i);
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/sources/:idx/name
pub async fn put_source_name(
    State(s): State<AppState>,
    Path(idx): Path<usize>,
    Json(u): Json<NameUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if idx >= cfg.sources.len() {
        return (StatusCode::BAD_REQUEST, "index out of range").into_response();
    }
    cfg.sources[idx] = u.name;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// PUT /api/v1/zones/:idx/name
pub async fn put_zone_name(
    State(s): State<AppState>,
    Path(idx): Path<usize>,
    Json(u): Json<NameUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if idx >= cfg.zones.len() {
        return (StatusCode::BAD_REQUEST, "index out of range").into_response();
    }
    cfg.zones[idx] = u.name;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// GET /api/v1/zones/:tx/eq
pub async fn get_eq(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.per_output_eq.get(tx) {
        Some(eq) => Json(eq.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/zones/:tx/eq
pub async fn put_eq(
    State(s): State<AppState>,
    Path(tx): Path<usize>,
    Json(u): Json<EqUpdate>,
) -> impl IntoResponse {
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
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/zones/:tx/eq/enabled
pub async fn put_eq_enabled(
    State(s): State<AppState>,
    Path(tx): Path<usize>,
    Json(u): Json<EqEnabledUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(eq) = cfg.per_output_eq.get_mut(tx) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    eq.enabled = u.enabled;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/zones/:tx/limiter
pub async fn get_limiter(State(s): State<AppState>, Path(tx): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.per_output_limiter.get(tx) {
        Some(lim) => Json(lim.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/zones/:tx/limiter
pub async fn put_limiter(
    State(s): State<AppState>,
    Path(tx): Path<usize>,
    Json(u): Json<LimiterUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(lim) = cfg.per_output_limiter.get_mut(tx) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    lim.threshold_db = u.threshold_db.clamp(-40.0, 0.0);
    lim.attack_ms = u.attack_ms.clamp(0.1, 50.0);
    lim.release_ms = u.release_ms.clamp(10.0, 2000.0);
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/zones/:tx/limiter/enabled
pub async fn put_limiter_enabled(
    State(s): State<AppState>,
    Path(tx): Path<usize>,
    Json(u): Json<LimiterEnabledUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(lim) = cfg.per_output_limiter.get_mut(tx) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    lim.enabled = u.enabled;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}
