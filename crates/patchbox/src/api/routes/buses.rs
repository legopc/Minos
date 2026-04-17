use crate::api::{
    dsp_to_value, parse_bus_id, ws_broadcast, EnabledBody, GainBody, MutedBody, PolarityBody,
};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use patchbox_core::config::{
    CompressorConfig, EqConfig, FilterConfig, GateConfig, InternalBusConfig,
};
use patchbox_core::dsp::DspBlock;

#[derive(serde::Serialize)]
pub(crate) struct BusResponse {
    id: String,
    name: String,
    muted: bool,
    routing: Vec<bool>,
    routing_gain: Vec<f32>,
    dsp: serde_json::Value,
}

#[derive(serde::Deserialize)]
pub(crate) struct CreateBusRequest {
    name: Option<String>,
}

#[derive(serde::Deserialize)]
pub(crate) struct UpdateBusRequest {
    name: Option<String>,
    muted: Option<bool>,
}

#[derive(serde::Deserialize)]
pub(crate) struct BusRoutingBody {
    routing: Vec<bool>,
}

#[derive(serde::Deserialize)]
pub(crate) struct BusMatrixBody {
    matrix: Vec<Vec<bool>>,
}

#[derive(serde::Deserialize)]
pub(crate) struct BusInputGainBody {
    rx: usize,
    gain_db: f32,
}

#[derive(serde::Deserialize)]
pub(crate) struct BusFeedBody {
    src_id: String,
    dst_id: String,
    active: bool,
}

pub(crate) fn bus_to_response(_idx: usize, bus: &InternalBusConfig) -> BusResponse {
    BusResponse {
        id: bus.id.clone(),
        name: bus.name.clone(),
        muted: bus.muted,
        routing: bus.routing.clone(),
        routing_gain: bus.routing_gain.clone(),
        dsp: dsp_to_value(&bus.dsp),
    }
}

// GET /api/v1/buses
pub(crate) async fn get_buses(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let buses: Vec<BusResponse> = cfg
        .internal_buses
        .iter()
        .enumerate()
        .map(|(i, b)| bus_to_response(i, b))
        .collect();
    Json(buses)
}

// POST /api/v1/buses
pub(crate) async fn post_bus(
    State(s): State<AppState>,
    Json(body): Json<CreateBusRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let idx = cfg.internal_buses.len();
    let id = format!("bus_{}", idx);
    let name = body.name.unwrap_or_else(|| format!("Bus {}", idx + 1));
    let bus = patchbox_core::config::InternalBusConfig {
        id: id.clone(),
        name: name.clone(),
        routing: vec![false; cfg.rx_channels],
        routing_gain: vec![0.0; cfg.rx_channels],
        dsp: patchbox_core::config::InputChannelDsp::default(),
        muted: false,
    };
    if let Some(bm) = cfg.bus_matrix.as_mut() {
        for row in bm.iter_mut() {
            row.push(false);
        }
    } else if cfg.tx_channels > 0 {
        cfg.bus_matrix = Some(vec![vec![false]; cfg.tx_channels]);
    }
    let resp = bus_to_response(idx, &bus);
    cfg.internal_buses.push(bus);
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_created","bus":serde_json::to_value(&resp).unwrap_or_default()}).to_string());
    (StatusCode::CREATED, Json(resp)).into_response()
}

// GET /api/v1/buses/:id
pub(crate) async fn get_bus(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid bus id (expected bus_N)").into_response();
    };
    let cfg = s.config.read().await;
    match cfg.internal_buses.get(i) {
        Some(b) => Json(bus_to_response(i, b)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// PUT /api/v1/buses/:id
pub(crate) async fn put_bus(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateBusRequest>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid bus id (expected bus_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(name) = body.name {
        cfg.internal_buses[i].name = name;
    }
    if let Some(muted) = body.muted {
        cfg.internal_buses[i].muted = muted;
    }
    let ev = serde_json::json!({"type":"bus_update","id":&id,"name":cfg.internal_buses[i].name.clone(),"muted":cfg.internal_buses[i].muted});
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(&s, ev.to_string());
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/buses/:id
pub(crate) async fn delete_bus(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return (StatusCode::BAD_REQUEST, "invalid bus id (expected bus_N)").into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    cfg.internal_buses.remove(i);
    if let Some(bm) = cfg.bus_matrix.as_mut() {
        for row in bm.iter_mut() {
            if i < row.len() {
                row.remove(i);
            }
        }
    }
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_deleted","id":&id}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/gain
pub(crate) async fn put_bus_gain(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<GainBody>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    bus.dsp.gain_db = body.gain_db.clamp(-60.0, 24.0);
    let ev = serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"am","params":{"gain_db":bus.dsp.gain_db}});
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(&s, ev.to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/polarity
pub(crate) async fn put_bus_polarity(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PolarityBody>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    bus.dsp.polarity = body.invert;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"am","params":{"invert_polarity":body.invert}}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/hpf
pub(crate) async fn put_bus_hpf(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DspBlock<FilterConfig>>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    bus.dsp.hpf = params;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"flt"}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/lpf
pub(crate) async fn put_bus_lpf(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DspBlock<FilterConfig>>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    bus.dsp.lpf = params;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"flt"}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/eq
pub(crate) async fn put_bus_eq(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DspBlock<EqConfig>>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    bus.dsp.eq = params;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"peq"}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/eq/enabled
pub(crate) async fn put_bus_eq_enabled(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<EnabledBody>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    bus.dsp.eq.enabled = body.enabled;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"peq","params":{"enabled":body.enabled}}).to_string());
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/gate
pub(crate) async fn put_bus_gate(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DspBlock<GateConfig>>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    bus.dsp.gate = params;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"gte"}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/compressor
pub(crate) async fn put_bus_compressor(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DspBlock<CompressorConfig>>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut params = body.params;
    params.enabled = body.enabled;
    bus.dsp.compressor = params;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_dsp_update","id":&id,"block":"cmp"}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/mute
pub(crate) async fn put_bus_mute(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<MutedBody>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    let Some(bus) = cfg.internal_buses.get_mut(i) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    bus.muted = body.muted;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_update","id":&id,"muted":body.muted}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/routing
pub(crate) async fn put_bus_routing(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<BusRoutingBody>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let rx_channels = cfg.rx_channels;
    let mut routing = body.routing;
    routing.resize(rx_channels, false);
    cfg.internal_buses[i].routing = routing.clone();
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_routing_update","id":&id,"routing":routing}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/buses/:id/input-gain
pub(crate) async fn put_bus_input_gain(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<BusInputGainBody>,
) -> impl IntoResponse {
    let Some(i) = parse_bus_id(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut cfg = s.config.write().await;
    if i >= cfg.internal_buses.len() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if body.rx >= cfg.rx_channels {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let clamped = body.gain_db.clamp(-40.0, 12.0);
    cfg.internal_buses[i].routing_gain[body.rx] = clamped;
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// PUT /api/v1/bus-matrix
pub(crate) async fn put_bus_matrix(
    State(s): State<AppState>,
    Json(body): Json<BusMatrixBody>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let n_buses = cfg.internal_buses.len();
    let tx_channels = cfg.tx_channels;
    let mut matrix = body.matrix;
    matrix.resize(tx_channels, vec![false; n_buses]);
    for row in matrix.iter_mut() {
        row.resize(n_buses, false);
    }
    cfg.bus_matrix = Some(matrix.clone());
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_matrix_update","matrix":matrix}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/bus-feed-matrix
pub(crate) async fn get_bus_feed_matrix(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(cfg.bus_feed_matrix.clone().unwrap_or_default())
}

// PUT /api/v1/bus-feed
pub(crate) async fn put_bus_feed(
    State(s): State<AppState>,
    Json(body): Json<BusFeedBody>,
) -> impl IntoResponse {
    let src_idx = body
        .src_id
        .strip_prefix("bus_")
        .and_then(|s| s.parse::<usize>().ok());
    let dst_idx = body
        .dst_id
        .strip_prefix("bus_")
        .and_then(|s| s.parse::<usize>().ok());
    let (Some(src), Some(dst)) = (src_idx, dst_idx) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if src == dst {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut cfg = s.config.write().await;
    let n_buses = cfg.internal_buses.len();
    if src >= n_buses || dst >= n_buses {
        return StatusCode::NOT_FOUND.into_response();
    }
    let fm = cfg
        .bus_feed_matrix
        .get_or_insert_with(|| vec![vec![false; n_buses]; n_buses]);
    fm[dst][src] = body.active;
    let matrix = fm.clone();
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"bus_feed_update","matrix":matrix}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}
