use crate::api::{
    output_dsp_to_value, parse_tx_id, ws_broadcast, EnabledBody, GainBody, MutedBody,
};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use patchbox_core::config::{
    CompressorConfig, DelayConfig, DynamicEqConfig, EqConfig, FilterConfig, LimiterConfig,
};
use tracing;

#[derive(serde::Serialize)]
pub(crate) struct OutputResponse {
    id: String,
    name: String,
    zone_id: String,
    zone_colour_index: u8,
    volume_db: f32,
    muted: bool,
    polarity: bool,
    dsp: serde_json::Value,
}

#[derive(serde::Deserialize)]
pub(crate) struct UpdateOutputRequest {
    name: Option<String>,
    volume_db: Option<f32>,
    muted: Option<bool>,
}

#[derive(serde::Deserialize)]
pub(crate) struct DitherBody {
    bits: u8,
}

// GET /api/v1/outputs
pub(crate) async fn get_outputs(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let outputs: Vec<OutputResponse> = (0..cfg.tx_channels)
        .map(|i| {
            let name = cfg
                .zone_config
                .get(i)
                .map(|z| z.name.clone())
                .unwrap_or_else(|| {
                    cfg.zones
                        .get(i)
                        .cloned()
                        .unwrap_or_else(|| format!("Zone {}", i + 1))
                });
            let zone_id = cfg
                .zone_config
                .get(i)
                .map(|z| z.id.clone())
                .unwrap_or_else(|| format!("zone_{}", i));
            let zone_colour_index = cfg
                .zone_config
                .get(i)
                .map(|z| z.colour_index)
                .unwrap_or((i % 10) as u8);
            let dsp = cfg.output_dsp.get(i).cloned().unwrap_or_default();
            OutputResponse {
                id: format!("tx_{}", i),
                name,
                zone_id,
                zone_colour_index,
                volume_db: dsp.gain_db,
                muted: dsp.muted,
                polarity: dsp.polarity,
                dsp: output_dsp_to_value(&dsp),
            }
        })
        .collect();
    Json(outputs)
}

// GET /api/v1/outputs/:id
pub(crate) async fn get_output_resource(
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
    let name = cfg
        .zone_config
        .get(i)
        .map(|z| z.name.clone())
        .unwrap_or_else(|| {
            cfg.zones
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("Zone {}", i + 1))
        });
    let zone_id = cfg
        .zone_config
        .get(i)
        .map(|z| z.id.clone())
        .unwrap_or_else(|| format!("zone_{}", i));
    let zone_colour_index = cfg
        .zone_config
        .get(i)
        .map(|z| z.colour_index)
        .unwrap_or((i % 10) as u8);
    let dsp = cfg.output_dsp.get(i).cloned().unwrap_or_default();
    Json(OutputResponse {
        id: format!("tx_{}", i),
        name,
        zone_id,
        zone_colour_index,
        volume_db: dsp.gain_db,
        muted: dsp.muted,
        polarity: dsp.polarity,
        dsp: output_dsp_to_value(&dsp),
    })
    .into_response()
}

// PUT /api/v1/outputs/:id
#[tracing::instrument(skip_all, fields(output_id = %id))]
pub(crate) async fn put_output_resource(
    State(s): State<AppState>,
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
    if let Some(ref name) = body.name {
        if i < cfg.zones.len() {
            cfg.zones[i] = name.clone();
        }
        if i < cfg.zone_config.len() {
            cfg.zone_config[i].name = name.clone();
        }
    }
    if let Some(vol) = body.volume_db {
        if i < cfg.output_dsp.len() {
            cfg.output_dsp[i].gain_db = vol.clamp(-60.0, 24.0);
        }
    }
    if let Some(muted) = body.muted {
        if i < cfg.output_dsp.len() {
            cfg.output_dsp[i].muted = muted;
        }
        if i < cfg.output_muted.len() {
            cfg.output_muted[i] = muted;
        }
    }
    drop(cfg);
    crate::persist_or_500!(s);
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
    Path(ch): Path<usize>,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.gain_db = body.gain_db.clamp(-60.0, 24.0);
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/hpf
pub(crate) async fn put_output_hpf(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<FilterConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.hpf = body;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/lpf
pub(crate) async fn put_output_lpf(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<FilterConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.lpf = body;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq
pub(crate) async fn put_output_eq(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<EqConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.eq = body;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/eq/enabled
pub(crate) async fn put_output_eq_enabled(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<EnabledBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.eq.enabled = body.enabled;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/compressor
pub(crate) async fn put_output_compressor(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<CompressorConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.compressor = body;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/limiter
pub(crate) async fn put_output_limiter(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<LimiterConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.limiter = body;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/delay
pub(crate) async fn put_output_delay(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DelayConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.delay = body;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/dither
pub(crate) async fn put_output_dither(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DitherBody>,
) -> impl IntoResponse {
    if body.bits != 0 && body.bits != 16 && body.bits != 24 {
        return (StatusCode::BAD_REQUEST, "bits must be 0, 16, or 24").into_response();
    }
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.dither_bits = body.bits;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/enabled
pub(crate) async fn put_output_enabled(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<EnabledBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.enabled = body.enabled;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/outputs/:ch/mute
pub(crate) async fn put_output_mute(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<MutedBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.muted = body.muted;
    drop(cfg);
    crate::persist_or_500!(s);
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
    Path(ch): Path<usize>,
    Json(body): Json<DynamicEqConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.output_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.deq = body;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}
