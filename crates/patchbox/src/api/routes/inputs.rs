use crate::api::{dsp_to_value, parse_rx_id, EnabledBody, GainBody, PolarityBody};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use patchbox_core::config::{
    AecConfig, CompressorConfig, DynamicEqConfig, EqConfig, FilterConfig, GateConfig,
};
use patchbox_core::dsp::DspBlock;
use tracing;

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ChannelResponse {
    id: String,
    name: String,
    #[schema(value_type = String)]
    source_type: &'static str,
    gain_db: f32,
    enabled: bool,
    colour_index: Option<u8>,
    #[schema(value_type = Object)]
    dsp: serde_json::Value,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct UpdateChannelRequest {
    name: Option<String>,
    gain_db: Option<f32>,
    enabled: Option<bool>,
    colour_index: Option<Option<u8>>,
}

#[derive(serde::Deserialize)]
pub struct UpdateAutomixerChannelRequest {
    pub enabled: Option<bool>,
    pub group_id: Option<String>,
    pub weight: Option<f32>,
}

#[derive(serde::Deserialize)]
pub struct UpdateFeedbackSuppressorRequest {
    pub enabled: Option<bool>,
    pub threshold_db: Option<f32>,
    pub hysteresis_db: Option<f32>,
    pub bandwidth_hz: Option<f32>,
    pub max_notches: Option<usize>,
    pub auto_reset: Option<bool>,
    pub quiet_hold_ms: Option<f32>,
    pub quiet_threshold_db: Option<f32>,
    pub reset_notches: Option<bool>,
}

// GET /api/v1/channels
#[utoipa::path(
    get,
    path = "/api/v1/channels",
    tag = "channels",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of input channels", body = Vec<ChannelResponse>),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_channels(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let channels: Vec<ChannelResponse> = (0..cfg.rx_channels)
        .map(|i| {
            let name = cfg
                .sources
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("Source {}", i + 1));
            let dsp = cfg.input_dsp.get(i).cloned().unwrap_or_default();
            let colour_index = cfg.input_colours.get(i).copied().and_then(|v| {
                if v < 0 {
                    None
                } else {
                    Some(v as u8)
                }
            });
            ChannelResponse {
                id: format!("rx_{}", i),
                name,
                source_type: "dante",
                gain_db: dsp.gain_db,
                enabled: dsp.enabled,
                colour_index,
                dsp: dsp_to_value(&dsp),
            }
        })
        .collect();
    Json(channels)
}

// GET /api/v1/channels/:id
#[utoipa::path(
    get,
    path = "/api/v1/channels/{id}",
    tag = "channels",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "Channel ID e.g. rx_0")),
    responses(
        (status = 200, description = "Channel details", body = ChannelResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 404, description = "Not found")
    )
)]
pub async fn get_channel(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(i) = parse_rx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid channel id").into_response();
    };
    let cfg = s.config.read().await;
    if i >= cfg.rx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    let name = cfg
        .sources
        .get(i)
        .cloned()
        .unwrap_or_else(|| format!("Source {}", i + 1));
    let dsp = cfg.input_dsp.get(i).cloned().unwrap_or_default();
    let colour_index =
        cfg.input_colours
            .get(i)
            .copied()
            .and_then(|v| if v < 0 { None } else { Some(v as u8) });
    Json(ChannelResponse {
        id: format!("rx_{}", i),
        name,
        source_type: "dante",
        gain_db: dsp.gain_db,
        enabled: dsp.enabled,
        colour_index,
        dsp: dsp_to_value(&dsp),
    })
    .into_response()
}

// PUT /api/v1/channels/:id
#[utoipa::path(
    put,
    path = "/api/v1/channels/{id}",
    tag = "channels",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "Channel ID e.g. rx_0")),
    request_body = UpdateChannelRequest,
    responses(
        (status = 204, description = "Updated"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 404, description = "Not found")
    )
)]
#[tracing::instrument(skip_all, fields(channel_id = %id))]
pub async fn put_channel(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateChannelRequest>,
) -> impl IntoResponse {
    let Some(i) = parse_rx_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid channel id").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.rx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(name) = body.name {
        if i < cfg.sources.len() {
            cfg.sources[i] = name;
        }
    }
    if let Some(gain) = body.gain_db {
        if i < cfg.input_dsp.len() {
            cfg.input_dsp[i].gain_db = gain.clamp(-60.0, 24.0);
        }
    }
    if let Some(enabled) = body.enabled {
        if i < cfg.input_dsp.len() {
            cfg.input_dsp[i].enabled = enabled;
        }
    }
    if let Some(colour_index) = body.colour_index {
        if i >= cfg.input_colours.len() {
            cfg.input_colours.resize(i + 1, -1);
        }
        cfg.input_colours[i] = colour_index.map(|c| (c % 10) as i8).unwrap_or(-1);
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/inputs/:ch/dsp
pub async fn get_input_dsp(State(s): State<AppState>, Path(ch): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.input_dsp.get(ch) {
        Some(dsp) => Json(dsp.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/inputs/:ch/gain
pub async fn put_input_gain(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let clamped = body.gain_db.clamp(-60.0, 24.0);
    dsp.gain_db = clamped;
    // Stereo link mirroring
    let pair_ch = cfg.stereo_links.iter().find_map(|sl| {
        if sl.linked {
            if sl.left_channel == ch {
                Some(sl.right_channel)
            } else if sl.right_channel == ch {
                Some(sl.left_channel)
            } else {
                None
            }
        } else {
            None
        }
    });
    if let Some(p) = pair_ch {
        if let Some(pdsp) = cfg.input_dsp.get_mut(p) {
            pdsp.gain_db = clamped;
        }
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/polarity
pub async fn put_input_polarity(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<PolarityBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.polarity = body.invert;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/hpf
pub async fn put_input_hpf(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<FilterConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.hpf = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/lpf
pub async fn put_input_lpf(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<FilterConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.lpf = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/eq
pub async fn put_input_eq(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<EqConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.eq = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/eq/enabled
pub async fn put_input_eq_enabled(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<EnabledBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.eq.enabled = body.enabled;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/gate
pub async fn put_input_gate(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<GateConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.gate = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/compressor
pub async fn put_input_compressor(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<CompressorConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.compressor = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/inputs/:ch/aec
pub async fn get_input_aec(State(s): State<AppState>, Path(ch): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match cfg.input_dsp.get(ch) {
        Some(dsp) => Json(dsp.aec.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/inputs/:ch/aec
pub async fn put_input_aec(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<AecConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.aec = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/enabled
pub async fn put_input_enabled(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<EnabledBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    dsp.enabled = body.enabled;
    let pair_ch = cfg.stereo_links.iter().find_map(|sl| {
        if sl.linked {
            if sl.left_channel == ch {
                Some(sl.right_channel)
            } else if sl.right_channel == ch {
                Some(sl.left_channel)
            } else {
                None
            }
        } else {
            None
        }
    });
    if let Some(p) = pair_ch {
        if let Some(pdsp) = cfg.input_dsp.get_mut(p) {
            pdsp.enabled = body.enabled;
        }
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/inputs/:ch/automixer
pub async fn put_input_automixer(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<UpdateAutomixerChannelRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(e) = body.enabled {
        dsp.automixer.enabled = e;
    }
    if let Some(gid) = body.group_id {
        dsp.automixer.group_id = if gid.is_empty() { None } else { Some(gid) };
    }
    if let Some(w) = body.weight {
        dsp.automixer.weight = w.clamp(0.01, 10.0);
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/inputs/:ch/feedback
pub async fn get_input_feedback(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let Some(dsp) = cfg.input_dsp.get(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    Json(serde_json::json!(&dsp.feedback)).into_response()
}

// PUT /api/v1/inputs/:ch/feedback
pub async fn put_input_feedback(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<UpdateFeedbackSuppressorRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(v) = body.enabled {
        dsp.feedback.enabled = v;
    }
    if let Some(v) = body.threshold_db {
        dsp.feedback.threshold_db = v.clamp(-60.0, 0.0);
    }
    if let Some(v) = body.hysteresis_db {
        dsp.feedback.hysteresis_db = v.clamp(0.0, 30.0);
    }
    if let Some(v) = body.bandwidth_hz {
        dsp.feedback.bandwidth_hz = v.clamp(1.0, 100.0);
    }
    if let Some(v) = body.max_notches {
        dsp.feedback.max_notches = v.clamp(1, 8);
    }
    if let Some(v) = body.auto_reset {
        dsp.feedback.auto_reset = v;
    }
    if let Some(v) = body.quiet_hold_ms {
        dsp.feedback.quiet_hold_ms = v.clamp(100.0, 30_000.0);
    }
    if let Some(v) = body.quiet_threshold_db {
        dsp.feedback.quiet_threshold_db = v.clamp(-80.0, -20.0);
    }
    // reset_notches: toggle enabled off/on — RT sync() will deactivate all notches
    if body.reset_notches == Some(true) {
        let was = dsp.feedback.enabled;
        dsp.feedback.enabled = false;
        drop(cfg);
        let mut cfg2 = s.config.write().await;
        if let Some(d) = cfg2.input_dsp.get_mut(ch) {
            d.feedback.enabled = was;
        }
        drop(cfg2);
        s.schedule_persist().await;
        return StatusCode::NO_CONTENT.into_response();
    }
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/inputs/:ch/deq
pub async fn get_input_deq(State(s): State<AppState>, Path(ch): Path<usize>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let Some(dsp) = cfg.input_dsp.get(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    Json(serde_json::json!(&dsp.deq)).into_response()
}

// PUT /api/v1/inputs/:ch/deq
pub async fn put_input_deq(
    State(s): State<AppState>,
    Path(ch): Path<usize>,
    Json(body): Json<DspBlock<DynamicEqConfig>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(dsp) = cfg.input_dsp.get_mut(ch) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    dsp.deq = params;
    drop(cfg);
    s.schedule_persist().await;
    StatusCode::NO_CONTENT.into_response()
}
