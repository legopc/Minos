use crate::api::{dsp_to_value, parse_tx_id, ws_broadcast, EnabledBody, GainBody, MutedBody};
use crate::auth_api;
use crate::state::AppState;
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use patchbox_core::config::{
    CompressorConfig, DelayConfig, DynamicEqConfig, EqConfig, FilterConfig, LimiterConfig,
};
use patchbox_core::dsp::DspBlock;
use tracing;

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct OutputResponse {
    id: String,
    name: String,
    zone_id: String,
    zone_colour_index: u8,
    volume_db: f32,
    muted: bool,
    polarity: bool,
    #[schema(value_type = Object)]
    dsp: serde_json::Value,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct UpdateOutputRequest {
    name: Option<String>,
    volume_db: Option<f32>,
    muted: Option<bool>,
}

#[derive(serde::Deserialize)]
pub struct DitherBody {
    bits: u8,
}

fn ensure_output_zone_scope(
    cfg: &patchbox_core::config::PatchboxConfig,
    claims: Option<&Extension<crate::jwt::Claims>>,
    ch: usize,
    detail: &'static str,
) -> Result<(), Response> {
    auth_api::ensure_zone_scope_tx(cfg, claims, ch, detail)?;
    if let Some(peer) = cfg.output_stereo_peer(ch) {
        auth_api::ensure_zone_scope_tx(cfg, claims, peer, detail)?;
    }
    Ok(())
}

// GET /api/v1/outputs
#[utoipa::path(
    get,
    path = "/api/v1/outputs",
    tag = "outputs",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of outputs", body = Vec<OutputResponse>),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_outputs(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let outputs: Vec<OutputResponse> = (0..cfg.tx_channels)
        .map(|i| {
            let tx_id = format!("tx_{}", i);
            let zone = cfg
                .zone_config
                .iter()
                .find(|z| z.tx_ids.iter().any(|t| t == &tx_id));

            let name = cfg.zones.get(i).cloned().unwrap_or_else(|| format!("Output {}", i + 1));
            let zone_id = zone
                .map(|z| z.id.clone())
                .unwrap_or_else(|| format!("zone_{}", i));
            let zone_colour_index = zone.map(|z| z.colour_index).unwrap_or((i % 10) as u8);

            let dsp = cfg.output_dsp.get(i).cloned().unwrap_or_default();
            OutputResponse {
                id: tx_id,
                name,
                zone_id,
                zone_colour_index,
                volume_db: dsp.gain_db,
                muted: dsp.muted,
                polarity: dsp.polarity,
                dsp: dsp_to_value(&dsp),
            }
        })
        .collect();
    Json(outputs)
}

// GET /api/v1/outputs/:id
#[utoipa::path(
    get,
    path = "/api/v1/outputs/{id}",
    tag = "outputs",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "Output ID e.g. tx_0")),
    responses(
        (status = 200, description = "Output details", body = OutputResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 404, description = "Not found")
    )
)]
pub async fn get_output_resource(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(i) = parse_tx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid output id (expected tx_N)").into_response();
    };
    let cfg = s.config.read().await;
    if i >= cfg.tx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }

    let tx_id = format!("tx_{}", i);
    let zone = cfg
        .zone_config
        .iter()
        .find(|z| z.tx_ids.iter().any(|t| t == &tx_id));

    let name = cfg.zones.get(i).cloned().unwrap_or_else(|| format!("Output {}", i + 1));
    let zone_id = zone
        .map(|z| z.id.clone())
        .unwrap_or_else(|| format!("zone_{}", i));
    let zone_colour_index = zone.map(|z| z.colour_index).unwrap_or((i % 10) as u8);

    let dsp = cfg.output_dsp.get(i).cloned().unwrap_or_default();
    Json(OutputResponse {
        id: tx_id,
        name,
        zone_id,
        zone_colour_index,
        volume_db: dsp.gain_db,
        muted: dsp.muted,
        polarity: dsp.polarity,
        dsp: dsp_to_value(&dsp),
    })
    .into_response()
}

// PUT /api/v1/outputs/:id
#[utoipa::path(
    put,
    path = "/api/v1/outputs/{id}",
    tag = "outputs",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "Output ID e.g. tx_0")),
    request_body = UpdateOutputRequest,
    responses(
        (status = 204, description = "Updated"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 404, description = "Not found")
    )
)]
#[tracing::instrument(skip_all, fields(output_id = %id))]
pub async fn put_output_resource(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateOutputRequest>,
) -> impl IntoResponse {
    let Some(i) = parse_tx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid output id (expected tx_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.tx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        i,
        "Zone-scoped users can only update outputs in their own zone.",
    ) {
        return response;
    }
    let pair_ch = cfg.output_stereo_peer(i);
    if let Some(ref name) = body.name {
        if i < cfg.zones.len() {
            cfg.zones[i] = name.clone();
        }
        let tx_id = format!("tx_{}", i);
        if let Some(z) = cfg
            .zone_config
            .iter_mut()
            .find(|z| z.tx_ids.iter().any(|t| t == &tx_id))
        {
            z.name = name.clone();
        }
    }
    if let Some(vol) = body.volume_db {
        let clamped = vol.clamp(-60.0, 24.0);
        if i < cfg.output_dsp.len() {
            cfg.output_dsp[i].gain_db = clamped;
        }
        if let Some(p) = pair_ch {
            if p < cfg.output_dsp.len() {
                cfg.output_dsp[p].gain_db = clamped;
            }
        }
    }
    if let Some(muted) = body.muted {
        if i < cfg.output_dsp.len() {
            cfg.output_dsp[i].muted = muted;
        }
        if i < cfg.output_muted.len() {
            cfg.output_muted[i] = muted;
        }
        if let Some(p) = pair_ch {
            if p < cfg.output_dsp.len() {
                cfg.output_dsp[p].muted = muted;
            }
            if p < cfg.output_muted.len() {
                cfg.output_muted[p] = muted;
            }
        }
    }
    drop(cfg);
    s.schedule_persist().await;
    ws_broadcast(&s, serde_json::json!({"type":"output_update","id":&id,"volume_db":body.volume_db,"muted":body.muted}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/outputs/:ch/dsp
pub(crate) async fn get_output_dsp(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.output_dsp.get(ch) {
        Some(dsp) => Json(dsp.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/outputs/:ch/gain
pub(crate) async fn put_output_gain(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only adjust output gain in their own zone.",
    ) {
        return response;
    }
    let pair_ch = cfg.output_stereo_peer(ch);
    let clamped = body.gain_db.clamp(-60.0, 24.0);
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.gain_db = clamped;
    if let Some(p) = pair_ch {
        if let Some(pdsp) = cfg.output_dsp.get_mut(p) {
            pdsp.gain_db = clamped;
        }
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/hpf
pub(crate) async fn put_output_hpf(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<FilterConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.hpf = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/lpf
pub(crate) async fn put_output_lpf(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<FilterConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.lpf = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq
pub(crate) async fn put_output_eq(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<EqConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.eq = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq/enabled
pub(crate) async fn put_output_eq_enabled(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<EnabledBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.eq.enabled = body.enabled;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/compressor
pub(crate) async fn put_output_compressor(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<CompressorConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.compressor = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/limiter
pub(crate) async fn put_output_limiter(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<LimiterConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.limiter = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/delay
pub(crate) async fn put_output_delay(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<DelayConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.delay = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/dither
pub(crate) async fn put_output_dither(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DitherBody>,
) -> impl IntoResponse {
    if body.bits != 0 && body.bits != 16 && body.bits != 24 {
        return (StatusCode::BAD_REQUEST, "bits must be 0, 16, or 24").into_response();
    }
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.dither_bits = body.bits;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/enabled
pub(crate) async fn put_output_enabled(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<EnabledBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update outputs in their own zone.",
    ) {
        return response;
    }
    let pair_ch = cfg.output_stereo_peer(ch);
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.enabled = body.enabled;
    if let Some(p) = pair_ch {
        if let Some(pdsp) = cfg.output_dsp.get_mut(p) {
            pdsp.enabled = body.enabled;
        }
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/mute
pub(crate) async fn put_output_mute(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<MutedBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only mute outputs in their own zone.",
    ) {
        return response;
    }
    let pair_ch = cfg.output_stereo_peer(ch);
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.muted = body.muted;
    if let Some(p) = pair_ch {
        if let Some(pdsp) = cfg.output_dsp.get_mut(p) {
            pdsp.muted = body.muted;
        }
        if let Some(pm) = cfg.output_muted.get_mut(p) {
            *pm = body.muted;
        }
    }
    if let Some(m) = cfg.output_muted.get_mut(ch) {
        *m = body.muted;
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/outputs/:ch/deq
pub(crate) async fn get_output_deq(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let Some(dsp) = cfg.output_dsp.get(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    Json(serde_json::json!(&dsp.deq)).into_response()
}

// PUT /api/v1/outputs/:ch/deq
pub(crate) async fn put_output_deq(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<DynamicEqConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if cfg.output_dsp.get(ch).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_output_zone_scope(
        &cfg,
        claims.as_ref(),
        ch,
        "Zone-scoped users can only update output DSP in their own zone.",
    ) {
        return response;
    }
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.deq = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}
