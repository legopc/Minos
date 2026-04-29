use crate::api::{linear_to_dbfs, parse_tx_id, parse_zone_id, parse_zone_template_id};
use crate::auth_api;
use crate::state::{AppState, EventActor, EventResource};
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use patchbox_core::config::{ZoneConfig, ZoneTemplateConfig, ZoneTemplateOutputConfig};
use std::collections::HashSet;
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

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct CreateZoneTemplateRequest {
    name: String,
    colour_index: Option<u8>,
    output: Option<ZoneTemplateOutputConfig>,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ZoneMetering {
    pub id: String,
    pub rms_db: f32,
    pub peak_db: f32,
    pub gr_db: f32,
    pub clip_count: u64,
}

// POST /api/v1/zones/:tx/mute
pub async fn mute_zone(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(tx): Path<usize>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "zone out of range").into_response();
    }
    if let Err(response) = auth_api::ensure_zone_scope_tx(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only mute outputs in their own zone.",
    ) {
        return response;
    }
    cfg.output_muted[tx] = true;
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.muted = true;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/zones/:tx/unmute
pub async fn unmute_zone(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(tx): Path<usize>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "zone out of range").into_response();
    }
    if let Err(response) = auth_api::ensure_zone_scope_tx(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only unmute outputs in their own zone.",
    ) {
        return response;
    }
    cfg.output_muted[tx] = false;
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.muted = false;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/mute-all
pub async fn mute_all(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot mute all outputs.",
    ) {
        return response;
    }
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() {
        *m = true;
    }
    for dsp in cfg.output_dsp.iter_mut() {
        dsp.muted = true;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// POST /api/v1/unmute-all
pub async fn unmute_all(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot unmute all outputs.",
    ) {
        return response;
    }
    let mut cfg = s.config.write().await;
    for m in cfg.output_muted.iter_mut() {
        *m = false;
    }
    for dsp in cfg.output_dsp.iter_mut() {
        dsp.muted = false;
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

// GET /api/v1/zones/templates
#[utoipa::path(
    get,
    path = "/api/v1/zones/templates",
    tag = "zones",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of zone templates", body = Vec<ZoneTemplateConfig>),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_zone_templates(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(cfg.zone_templates.clone())
}

// GET /api/v1/zones/metering
#[utoipa::path(
    get,
    path = "/api/v1/zones/metering",
    tag = "zones",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Per-zone metering"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_zone_metering(State(s): State<AppState>) -> impl IntoResponse {
    let zones = {
        let cfg = s.config.read().await;
        cfg.zone_config.clone()
    };
    let meters = s.meters.read().await.clone();

    let metering: Vec<ZoneMetering> = zones
        .into_iter()
        .map(|zone| {
            let tx_indices: Vec<usize> = zone
                .tx_ids
                .iter()
                .filter_map(|id| parse_tx_id(id))
                .collect();

            let rms_db = tx_indices
                .iter()
                .filter_map(|&idx| meters.tx_rms.get(idx).copied())
                .map(linear_to_dbfs)
                .fold(-60.0_f32, f32::max);
            let peak_db = tx_indices
                .iter()
                .filter_map(|&idx| meters.tx_peak.get(idx).copied())
                .map(linear_to_dbfs)
                .fold(-60.0_f32, f32::max);
            let gr_db = tx_indices
                .iter()
                .filter_map(|&idx| meters.tx_gr_db.get(idx).copied())
                .fold(0.0_f32, f32::min);
            let clip_count = tx_indices
                .iter()
                .filter_map(|&idx| meters.tx_clip_count.get(idx).copied())
                .sum();

            ZoneMetering {
                id: zone.id,
                rms_db,
                peak_db,
                gr_db,
                clip_count,
            }
        })
        .collect();

    Json(metering)
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
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(body): Json<CreateZoneRequest>,
) -> impl IntoResponse {
    if let Err(response) =
        auth_api::ensure_not_zone_scoped(claims.as_ref(), "Zone-scoped users cannot create zones.")
    {
        return response;
    }
    let mut cfg = s.config.write().await;

    let mut tx_ids = body.tx_ids.unwrap_or_default();
    let mut seen = HashSet::<String>::new();
    tx_ids.retain(|id| seen.insert(id.clone()));

    for tx_id in &tx_ids {
        let Some(tx) = parse_tx_id(tx_id) else {
            return (StatusCode::BAD_REQUEST, "invalid tx_id (expected tx_N)").into_response();
        };
        if tx >= cfg.tx_channels {
            return (StatusCode::BAD_REQUEST, "tx_id out of range").into_response();
        }
    }

    // Ensure a TX output belongs to at most one zone.
    if !tx_ids.is_empty() {
        let desired: HashSet<String> = tx_ids.iter().cloned().collect();
        for z in cfg.zone_config.iter_mut() {
            z.tx_ids.retain(|t| !desired.contains(t));
        }
    }

    let id_n = cfg.next_zone_id;
    cfg.next_zone_id = cfg.next_zone_id.saturating_add(1);
    let zone = ZoneConfig {
        id: format!("zone_{}", id_n),
        name: body.name,
        colour_index: body.colour_index.unwrap_or((id_n % 10) as u8),
        tx_ids,
    };
    cfg.zone_config.push(zone.clone());
    drop(cfg);
    crate::persist_or_500!(s);
    s.push_audit_log(
        "zone.create",
        format!("Created zone {}.", zone.id),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "zone",
            Some(zone.id.clone()),
            Some(zone.name.clone()),
        )),
        Some(serde_json::json!({
            "colour_index": zone.colour_index,
            "tx_ids": zone.tx_ids,
        })),
    )
    .await;
    (StatusCode::CREATED, Json(zone)).into_response()
}

// POST /api/v1/zones/templates
#[utoipa::path(
    post,
    path = "/api/v1/zones/templates",
    tag = "zones",
    security(("bearer_auth" = [])),
    request_body = CreateZoneTemplateRequest,
    responses(
        (status = 201, description = "Zone template created", body = ZoneTemplateConfig),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn post_zone_template(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(body): Json<CreateZoneTemplateRequest>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot manage zone templates.",
    ) {
        return response;
    }
    let mut output = body.output.unwrap_or_default();
    output.gain_db = output.gain_db.clamp(-60.0, 24.0);

    let mut cfg = s.config.write().await;
    let id_n = cfg.next_zone_template_id;
    cfg.next_zone_template_id = cfg.next_zone_template_id.saturating_add(1);
    let template = ZoneTemplateConfig {
        id: format!("zone_template_{}", id_n),
        name: body.name,
        colour_index: body.colour_index.unwrap_or(0),
        output,
    };
    cfg.zone_templates.push(template.clone());
    drop(cfg);
    crate::persist_or_500!(s);
    s.push_audit_log(
        "zone_template.create",
        format!("Created zone template {}.", template.id),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "zone_template",
            Some(template.id.clone()),
            Some(template.name.clone()),
        )),
        Some(serde_json::json!({
            "colour_index": template.colour_index,
            "output": template.output,
        })),
    )
    .await;
    (StatusCode::CREATED, Json(template)).into_response()
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
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(zone_id): Path<String>,
    Json(body): Json<UpdateZoneRequest>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot edit zone definitions.",
    ) {
        return response;
    }
    if parse_zone_id(&zone_id).is_none() {
        return (StatusCode::BAD_REQUEST, "invalid zone id (expected zone_N)").into_response();
    }
    let requested_name = body.name.clone();
    let requested_colour_index = body.colour_index;
    let requested_tx_ids = body.tx_ids.clone();

    let mut cfg = s.config.write().await;
    let Some(i) = cfg.zone_config.iter().position(|z| z.id == zone_id) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if let Some(name) = requested_name.clone() {
        cfg.zone_config[i].name = name;
    }
    if let Some(ci) = requested_colour_index {
        cfg.zone_config[i].colour_index = ci;
    }
    if let Some(mut tx_ids) = requested_tx_ids.clone() {
        let mut seen = HashSet::<String>::new();
        tx_ids.retain(|id| seen.insert(id.clone()));

        for tx_id in &tx_ids {
            let Some(tx) = parse_tx_id(tx_id) else {
                return (StatusCode::BAD_REQUEST, "invalid tx_id (expected tx_N)").into_response();
            };
            if tx >= cfg.tx_channels {
                return (StatusCode::BAD_REQUEST, "tx_id out of range").into_response();
            }
        }

        if !tx_ids.is_empty() {
            let desired: HashSet<String> = tx_ids.iter().cloned().collect();
            for (j, z) in cfg.zone_config.iter_mut().enumerate() {
                if j == i {
                    continue;
                }
                z.tx_ids.retain(|t| !desired.contains(t));
            }
        }

        cfg.zone_config[i].tx_ids = tx_ids;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    s.push_audit_log(
        "zone.update",
        format!("Updated zone {zone_id}."),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "zone",
            Some(zone_id.clone()),
            Some(zone_id.clone()),
        )),
        Some(serde_json::json!({
            "name": requested_name,
            "colour_index": requested_colour_index,
            "tx_ids": requested_tx_ids,
        })),
    )
    .await;
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
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(zone_id): Path<String>,
) -> impl IntoResponse {
    if let Err(response) =
        auth_api::ensure_not_zone_scoped(claims.as_ref(), "Zone-scoped users cannot delete zones.")
    {
        return response;
    }
    if parse_zone_id(&zone_id).is_none() {
        return (StatusCode::BAD_REQUEST, "invalid zone id (expected zone_N)").into_response();
    }
    let mut cfg = s.config.write().await;
    let Some(i) = cfg.zone_config.iter().position(|z| z.id == zone_id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let removed = cfg.zone_config.remove(i);
    drop(cfg);
    crate::persist_or_500!(s);
    s.push_audit_log(
        "zone.delete",
        format!("Deleted zone {zone_id}."),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "zone",
            Some(zone_id.clone()),
            Some(removed.name),
        )),
        Some(serde_json::json!({
            "tx_ids": removed.tx_ids,
        })),
    )
    .await;
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/zones/templates/:template_id
#[utoipa::path(
    delete,
    path = "/api/v1/zones/templates/{template_id}",
    tag = "zones",
    security(("bearer_auth" = [])),
    params(("template_id" = String, Path, description = "Zone template ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn delete_zone_template(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(template_id): Path<String>,
) -> impl IntoResponse {
    if let Err(response) = auth_api::ensure_not_zone_scoped(
        claims.as_ref(),
        "Zone-scoped users cannot manage zone templates.",
    ) {
        return response;
    }
    if parse_zone_template_id(&template_id).is_none() {
        return (
            StatusCode::BAD_REQUEST,
            "invalid zone template id (expected zone_template_N)",
        )
            .into_response();
    }
    let mut cfg = s.config.write().await;
    let Some(i) = cfg
        .zone_templates
        .iter()
        .position(|template| template.id == template_id)
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let removed = cfg.zone_templates.remove(i);
    drop(cfg);
    crate::persist_or_500!(s);
    s.push_audit_log(
        "zone_template.delete",
        format!("Deleted zone template {template_id}."),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "zone_template",
            Some(template_id.clone()),
            Some(removed.name),
        )),
        Some(serde_json::json!({
            "colour_index": removed.colour_index,
            "output": removed.output,
        })),
    )
    .await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/sources/:idx/name
pub async fn put_source_name(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(idx): Path<usize>,
    Json(u): Json<NameUpdate>,
) -> impl IntoResponse {
    if let Err(response) =
        auth_api::ensure_not_zone_scoped(claims.as_ref(), "Zone-scoped users cannot rename inputs.")
    {
        return response;
    }
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
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(idx): Path<usize>,
    Json(u): Json<NameUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if idx >= cfg.zones.len() {
        return (StatusCode::BAD_REQUEST, "index out of range").into_response();
    }
    if let Err(response) = auth_api::ensure_zone_scope_tx(
        &cfg,
        claims.as_ref(),
        idx,
        "Zone-scoped users can only rename outputs in their own zone.",
    ) {
        return response;
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
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(tx): Path<usize>,
    Json(u): Json<EqUpdate>,
) -> impl IntoResponse {
    if u.band >= 3 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut cfg = s.config.write().await;
    if cfg.per_output_eq.get(tx).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = auth_api::ensure_zone_scope_tx(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only update EQ in their own zone.",
    ) {
        return response;
    }
    let eq_ref = cfg.per_output_eq.get(tx).unwrap();
    let freq = u.freq_hz.clamp(20.0, 20_000.0);
    let gain = u.gain_db.clamp(-24.0, 24.0);
    let q = u.q.clamp(0.1, 10.0);
    let _ = eq_ref;
    if let Some(eq) = cfg.per_output_eq.get_mut(tx) {
        eq.bands[u.band].freq_hz = freq;
        eq.bands[u.band].gain_db = gain;
        eq.bands[u.band].q = q;
    }
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.eq.bands[u.band].freq_hz = freq;
        dsp.eq.bands[u.band].gain_db = gain;
        dsp.eq.bands[u.band].q = q;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/zones/:tx/eq/enabled
pub async fn put_eq_enabled(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(tx): Path<usize>,
    Json(u): Json<EqEnabledUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.per_output_eq.get(tx).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = auth_api::ensure_zone_scope_tx(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only update EQ in their own zone.",
    ) {
        return response;
    }
    let enabled = u.enabled;
    if let Some(eq) = cfg.per_output_eq.get_mut(tx) {
        eq.enabled = enabled;
    }
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.eq.enabled = enabled;
    }
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
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(tx): Path<usize>,
    Json(u): Json<LimiterUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.per_output_limiter.get(tx).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = auth_api::ensure_zone_scope_tx(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only update limiters in their own zone.",
    ) {
        return response;
    }
    let lim_ref = cfg.per_output_limiter.get(tx).unwrap();
    let threshold = u.threshold_db.clamp(-40.0, 0.0);
    let attack = u.attack_ms.clamp(0.1, 50.0);
    let release = u.release_ms.clamp(10.0, 2000.0);
    let _ = lim_ref;
    if let Some(lim) = cfg.per_output_limiter.get_mut(tx) {
        lim.threshold_db = threshold;
        lim.attack_ms = attack;
        lim.release_ms = release;
    }
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.limiter.threshold_db = threshold;
        dsp.limiter.attack_ms = attack;
        dsp.limiter.release_ms = release;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/zones/:tx/limiter/enabled
pub async fn put_limiter_enabled(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(tx): Path<usize>,
    Json(u): Json<LimiterEnabledUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.per_output_limiter.get(tx).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = auth_api::ensure_zone_scope_tx(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only update limiters in their own zone.",
    ) {
        return response;
    }
    let enabled = u.enabled;
    if let Some(lim) = cfg.per_output_limiter.get_mut(tx) {
        lim.enabled = enabled;
    }
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.limiter.enabled = enabled;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}
