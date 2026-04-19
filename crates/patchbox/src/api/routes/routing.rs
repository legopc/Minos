use crate::api::{parse_bus_id, parse_rx_id, parse_tx_id, ws_broadcast};
use crate::auth_api;
use crate::state::{AppState, EventActor, EventResource};
use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use patchbox_core::config::{SignalGenType, SignalGeneratorConfig};
use std::collections::{BTreeSet, HashMap};
use tracing;

#[derive(serde::Deserialize)]
pub struct MatrixUpdate {
    pub tx: usize,
    pub rx: usize,
    pub enabled: bool,
    /// Optional per-crosspoint gain in dB. Only applied when enabled=true. Range: [-40, 12].
    pub gain_db: Option<f32>,
}

#[derive(serde::Deserialize)]
pub struct GainUpdate {
    pub channel: usize,
    pub db: f32,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MatrixState {
    enabled: Vec<Vec<bool>>,
    gain_db: Vec<Vec<f32>>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct RouteResponse {
    id: String,
    rx_id: String,
    tx_id: String,
    #[schema(value_type = String)]
    route_type: &'static str,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct CreateRouteRequest {
    rx_id: String,
    tx_id: String,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct RouteTraceQuery {
    tx_id: String,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RouteTraceKind {
    Direct,
    Bus,
    Generator,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RouteTraceHopKind {
    Input,
    Bus,
    Output,
    Generator,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct RouteTraceHop {
    id: String,
    kind: RouteTraceHopKind,
    name: String,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct RouteTracePath {
    kind: RouteTraceKind,
    summary: String,
    hops: Vec<RouteTraceHop>,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct RouteTraceResponse {
    output_id: String,
    output_name: String,
    paths: Vec<RouteTracePath>,
    warnings: Vec<String>,
}

#[derive(serde::Deserialize)]
pub struct CreateVcaRequest {
    pub name: String,
    #[serde(default)]
    pub group_type: patchbox_core::config::VcaGroupType,
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub gain_db: f32,
}

#[derive(serde::Deserialize)]
pub struct UpdateVcaRequest {
    pub name: Option<String>,
    pub gain_db: Option<f32>,
    pub muted: Option<bool>,
    pub members: Option<Vec<String>>,
}

#[derive(serde::Deserialize)]
pub struct CreateAutomixerGroupRequest {
    pub name: String,
    #[serde(default = "default_true_req")]
    pub enabled: bool,
    #[serde(default)]
    pub gating_enabled: bool,
}
fn default_true_req() -> bool {
    true
}

#[derive(serde::Deserialize)]
pub struct UpdateAutomixerGroupRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub gate_threshold_db: Option<f32>,
    pub off_attenuation_db: Option<f32>,
    pub hold_ms: Option<f32>,
    pub last_mic_hold: Option<bool>,
    pub gating_enabled: Option<bool>,
}

#[derive(serde::Deserialize)]
pub struct CreateStereoLinkRequest {
    pub left_channel: usize,
    pub right_channel: usize,
}

#[derive(serde::Deserialize)]
pub struct UpdateStereoLinkRequest {
    pub linked: Option<bool>,
    pub pan: Option<f32>,
}

#[derive(serde::Deserialize)]
pub struct CreateGeneratorRequest {
    name: String,
    #[serde(default)]
    gen_type: SignalGenType,
    #[serde(default = "default_gen_freq_api")]
    freq_hz: f32,
    #[serde(default = "default_gen_level_api")]
    level_db: f32,
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_sweep_start_api")]
    sweep_start_hz: f32,
    #[serde(default = "default_sweep_end_api")]
    sweep_end_hz: f32,
    #[serde(default = "default_sweep_duration_api")]
    sweep_duration_s: f32,
}

fn default_gen_freq_api() -> f32 {
    1000.0
}
fn default_gen_level_api() -> f32 {
    -20.0
}
fn default_sweep_start_api() -> f32 {
    20.0
}
fn default_sweep_end_api() -> f32 {
    20000.0
}
fn default_sweep_duration_api() -> f32 {
    10.0
}

#[derive(serde::Deserialize)]
pub struct UpdateGeneratorRequest {
    name: Option<String>,
    gen_type: Option<SignalGenType>,
    freq_hz: Option<f32>,
    level_db: Option<f32>,
    enabled: Option<bool>,
    sweep_start_hz: Option<f32>,
    sweep_end_hz: Option<f32>,
    sweep_duration_s: Option<f32>,
}

#[derive(serde::Deserialize)]
pub struct UpdateGeneratorMatrixRequest {
    /// gains[tx_idx] = gain_db (f32::NEG_INFINITY or absent = not routed)
    gains: Vec<f32>,
}

fn ensure_routing_zone_scope(
    cfg: &patchbox_core::config::PatchboxConfig,
    claims: Option<&Extension<crate::jwt::Claims>>,
    tx: usize,
    detail: &'static str,
) -> Result<(), axum::response::Response> {
    auth_api::ensure_zone_scope_tx(cfg, claims, tx, detail)
}

fn trace_input_name(cfg: &patchbox_core::config::PatchboxConfig, rx: usize) -> String {
    cfg.sources
        .get(rx)
        .cloned()
        .unwrap_or_else(|| format!("Source {}", rx + 1))
}

fn trace_output_name(cfg: &patchbox_core::config::PatchboxConfig, tx: usize) -> String {
    cfg.zones
        .get(tx)
        .cloned()
        .unwrap_or_else(|| format!("Output {}", tx + 1))
}

fn trace_bus_name(cfg: &patchbox_core::config::PatchboxConfig, bus_idx: usize) -> String {
    cfg.internal_buses
        .get(bus_idx)
        .map(|bus| bus.name.clone())
        .unwrap_or_else(|| format!("Bus {}", bus_idx + 1))
}

fn trace_generator_name(cfg: &patchbox_core::config::PatchboxConfig, gen_idx: usize) -> String {
    cfg.signal_generators
        .get(gen_idx)
        .map(|generator| generator.name.clone())
        .unwrap_or_else(|| format!("Generator {}", gen_idx + 1))
}

fn format_trace_summary(hops: &[RouteTraceHop]) -> String {
    hops.iter()
        .map(|hop| hop.name.as_str())
        .collect::<Vec<_>>()
        .join(" -> ")
}

fn trace_bus_paths(
    cfg: &patchbox_core::config::PatchboxConfig,
    bus_idx: usize,
    visited: &mut Vec<usize>,
    warnings: &mut BTreeSet<String>,
) -> Vec<RouteTracePath> {
    let Some(bus) = cfg.internal_buses.get(bus_idx) else {
        return vec![];
    };

    if let Some(loop_start) = visited.iter().position(|existing| *existing == bus_idx) {
        let cycle = visited[loop_start..]
            .iter()
            .copied()
            .chain(std::iter::once(bus_idx))
            .map(|idx| trace_bus_name(cfg, idx))
            .collect::<Vec<_>>()
            .join(" -> ");
        warnings.insert(format!("Bus feed loop detected: {cycle}."));
        return vec![];
    }

    visited.push(bus_idx);
    let bus_hop = RouteTraceHop {
        id: bus.id.clone(),
        kind: RouteTraceHopKind::Bus,
        name: bus.name.clone(),
    };
    let mut paths = Vec::new();

    for (rx, enabled) in bus.routing.iter().enumerate() {
        if !enabled {
            continue;
        }
        let input_hop = RouteTraceHop {
            id: format!("rx_{rx}"),
            kind: RouteTraceHopKind::Input,
            name: trace_input_name(cfg, rx),
        };
        let hops = vec![input_hop, bus_hop.clone()];
        paths.push(RouteTracePath {
            kind: RouteTraceKind::Bus,
            summary: format_trace_summary(&hops),
            hops,
        });
    }

    if let Some(feed_matrix) = cfg
        .bus_feed_matrix
        .as_ref()
        .and_then(|matrix| matrix.get(bus_idx))
    {
        for (upstream_idx, enabled) in feed_matrix.iter().enumerate() {
            if !enabled {
                continue;
            }

            let mut upstream_paths = trace_bus_paths(cfg, upstream_idx, visited, warnings);
            if upstream_paths.is_empty() {
                let upstream_hop = RouteTraceHop {
                    id: format!("bus_{upstream_idx}"),
                    kind: RouteTraceHopKind::Bus,
                    name: trace_bus_name(cfg, upstream_idx),
                };
                let hops = vec![upstream_hop, bus_hop.clone()];
                upstream_paths.push(RouteTracePath {
                    kind: RouteTraceKind::Bus,
                    summary: format_trace_summary(&hops),
                    hops,
                });
            } else {
                for path in &mut upstream_paths {
                    path.hops.push(bus_hop.clone());
                    path.summary = format_trace_summary(&path.hops);
                }
            }
            paths.extend(upstream_paths);
        }
    }

    visited.pop();
    paths
}

// PUT /api/v1/matrix
#[tracing::instrument(skip_all)]
pub async fn put_matrix(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(u): Json<MatrixUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if u.tx >= cfg.tx_channels || u.rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "out of range").into_response();
    }
    if let Err(response) = ensure_routing_zone_scope(
        &cfg,
        claims.as_ref(),
        u.tx,
        "Zone-scoped users can only change routes in their own zone.",
    ) {
        return response;
    }
    cfg.matrix[u.tx][u.rx] = u.enabled;
    if let Some(db) = u.gain_db {
        cfg.matrix_gain_db[u.tx][u.rx] = db.clamp(-40.0, 12.0);
    }
    drop(cfg);
    crate::persist_or_500!(s);
    s.push_audit_log(
        "route.matrix_update",
        format!("Updated matrix crosspoint rx_{} -> tx_{}.", u.rx, u.tx),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new(
            "route",
            Some(format!("rx_{}|tx_{}", u.rx, u.tx)),
            None,
        )),
        Some(serde_json::json!({
            "tx": u.tx,
            "rx": u.rx,
            "enabled": u.enabled,
            "gain_db": u.gain_db,
        })),
    )
    .await;
    StatusCode::OK.into_response()
}

// GET /api/v1/matrix
pub async fn get_matrix(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(MatrixState {
        enabled: cfg.matrix.clone(),
        gain_db: cfg.matrix_gain_db.clone(),
    })
}

// PUT /api/v1/gain/input
pub async fn put_gain_input(
    State(s): State<AppState>,
    Json(u): Json<GainUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if u.channel >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "out of range").into_response();
    }
    cfg.input_gain_db[u.channel] = u.db.clamp(-60.0, 12.0);
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// PUT /api/v1/gain/output
pub async fn put_gain_output(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(u): Json<GainUpdate>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if u.channel >= cfg.tx_channels {
        return (StatusCode::BAD_REQUEST, "out of range").into_response();
    }
    if let Err(response) = ensure_routing_zone_scope(
        &cfg,
        claims.as_ref(),
        u.channel,
        "Zone-scoped users can only change outputs in their own zone.",
    ) {
        return response;
    }
    cfg.output_gain_db[u.channel] = u.db.clamp(-60.0, 12.0);
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::OK.into_response()
}

// GET /api/v1/routes
#[utoipa::path(
    get,
    path = "/api/v1/routes",
    tag = "routing",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "All active routes", body = Vec<RouteResponse>),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_routes(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let mut routes = Vec::new();
    for (tx, row) in cfg.matrix.iter().enumerate() {
        for (rx, &enabled) in row.iter().enumerate() {
            if enabled {
                routes.push(RouteResponse {
                    id: format!("rx_{}|tx_{}", rx, tx),
                    rx_id: format!("rx_{}", rx),
                    tx_id: format!("tx_{}", tx),
                    route_type: "dante",
                });
            }
        }
    }
    // Bus→TX routes
    if let Some(bm) = cfg.bus_matrix.as_ref() {
        for (tx, row) in bm.iter().enumerate() {
            for (b, &enabled) in row.iter().enumerate() {
                if enabled {
                    routes.push(RouteResponse {
                        id: format!("bus_{}|tx_{}", b, tx),
                        rx_id: format!("bus_{}", b),
                        tx_id: format!("tx_{}", tx),
                        route_type: "bus",
                    });
                }
            }
        }
    }
    Json(routes)
}

// GET /api/v1/routes/trace?tx_id=tx_N
#[utoipa::path(
    get,
    path = "/api/v1/routes/trace",
    tag = "routing",
    security(("bearer_auth" = [])),
    params(RouteTraceQuery),
    responses(
        (status = 200, description = "Resolved trace for one output", body = RouteTraceResponse),
        (status = 400, description = "Invalid output ID", body = crate::api::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 403, description = "Forbidden", body = crate::api::ErrorResponse),
        (status = 404, description = "Output not found", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_route_trace(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Query(query): Query<RouteTraceQuery>,
) -> impl IntoResponse {
    let Some(tx) = parse_tx_id(&query.tx_id) else {
        return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response();
    };

    let cfg = s.config.read().await;
    if tx >= cfg.tx_channels {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Err(response) = ensure_routing_zone_scope(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only trace outputs in their own zone.",
    ) {
        return response;
    }

    let output_id = format!("tx_{tx}");
    let output_name = trace_output_name(&cfg, tx);
    let output_hop = RouteTraceHop {
        id: output_id.clone(),
        kind: RouteTraceHopKind::Output,
        name: output_name.clone(),
    };
    let mut paths = Vec::new();
    let mut warnings = BTreeSet::new();

    if let Some(row) = cfg.matrix.get(tx) {
        for (rx, enabled) in row.iter().enumerate() {
            if !enabled {
                continue;
            }
            let hops = vec![
                RouteTraceHop {
                    id: format!("rx_{rx}"),
                    kind: RouteTraceHopKind::Input,
                    name: trace_input_name(&cfg, rx),
                },
                output_hop.clone(),
            ];
            paths.push(RouteTracePath {
                kind: RouteTraceKind::Direct,
                summary: format_trace_summary(&hops),
                hops,
            });
        }
    }

    if let Some(bus_matrix) = cfg.bus_matrix.as_ref().and_then(|matrix| matrix.get(tx)) {
        for (bus_idx, enabled) in bus_matrix.iter().enumerate() {
            if !enabled {
                continue;
            }
            let mut visited = Vec::new();
            let mut bus_paths = trace_bus_paths(&cfg, bus_idx, &mut visited, &mut warnings);
            if bus_paths.is_empty() {
                let hops = vec![
                    RouteTraceHop {
                        id: format!("bus_{bus_idx}"),
                        kind: RouteTraceHopKind::Bus,
                        name: trace_bus_name(&cfg, bus_idx),
                    },
                    output_hop.clone(),
                ];
                bus_paths.push(RouteTracePath {
                    kind: RouteTraceKind::Bus,
                    summary: format_trace_summary(&hops),
                    hops,
                });
                warnings.insert(format!(
                    "Bus '{}' feeds '{}', but no upstream sources were traced.",
                    trace_bus_name(&cfg, bus_idx),
                    output_name.as_str()
                ));
            } else {
                for path in &mut bus_paths {
                    path.hops.push(output_hop.clone());
                    path.summary = format_trace_summary(&path.hops);
                }
            }
            paths.extend(bus_paths);
        }
    }

    for (gen_idx, row) in cfg.generator_bus_matrix.iter().enumerate() {
        if !row
            .get(tx)
            .copied()
            .unwrap_or(f32::NEG_INFINITY)
            .is_finite()
        {
            continue;
        }
        let hops = vec![
            RouteTraceHop {
                id: cfg
                    .signal_generators
                    .get(gen_idx)
                    .map(|generator| generator.id.clone())
                    .unwrap_or_else(|| format!("generator_{gen_idx}")),
                kind: RouteTraceHopKind::Generator,
                name: trace_generator_name(&cfg, gen_idx),
            },
            output_hop.clone(),
        ];
        paths.push(RouteTracePath {
            kind: RouteTraceKind::Generator,
            summary: format_trace_summary(&hops),
            hops,
        });
    }

    paths.sort_by(|left, right| left.summary.cmp(&right.summary));

    Json(RouteTraceResponse {
        output_id,
        output_name,
        paths,
        warnings: warnings.into_iter().collect(),
    })
    .into_response()
}

// POST /api/v1/routes
#[utoipa::path(
    post,
    path = "/api/v1/routes",
    tag = "routing",
    security(("bearer_auth" = [])),
    request_body = CreateRouteRequest,
    responses(
        (status = 201, description = "Route created", body = RouteResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
#[tracing::instrument(skip_all, fields(rx_id, tx_id))]
pub async fn post_route(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(body): Json<CreateRouteRequest>,
) -> impl IntoResponse {
    // Handle bus→TX route
    if body.rx_id.starts_with("bus_") {
        let Some(b) = parse_bus_id(&body.rx_id) else {
            return (StatusCode::BAD_REQUEST, "invalid bus rx_id").into_response();
        };
        let Some(tx) = parse_tx_id(&body.tx_id) else {
            return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response();
        };
        let mut cfg = s.config.write().await;
        if tx >= cfg.tx_channels || b >= cfg.internal_buses.len() {
            return (StatusCode::BAD_REQUEST, "index out of range").into_response();
        }
        if let Err(response) = ensure_routing_zone_scope(
            &cfg,
            claims.as_ref(),
            tx,
            "Zone-scoped users can only change routes in their own zone.",
        ) {
            return response;
        }
        let n_buses = cfg.internal_buses.len();
        let tx_channels = cfg.tx_channels;
        if cfg.bus_matrix.is_none() {
            cfg.bus_matrix = Some(vec![vec![false; n_buses]; tx_channels]);
        }
        if let Some(bm) = cfg.bus_matrix.as_mut() {
            if tx < bm.len() && b < bm[tx].len() {
                bm[tx][b] = true;
            }
        }
        drop(cfg);
        crate::persist_or_500!(s);
        ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":&body.rx_id,"tx_id":&body.tx_id,"state":"on","route_type":"bus"}).to_string());
        let route_id = format!("bus_{}|tx_{}", b, tx);
        s.push_audit_log(
            "route.create",
            format!("Created route {route_id}."),
            None,
            claims
                .as_ref()
                .map(|Extension(claims)| EventActor::from_claims(claims)),
            Some(EventResource::new("route", Some(route_id.clone()), None)),
            Some(serde_json::json!({
                "rx_id": body.rx_id,
                "tx_id": body.tx_id,
                "route_type": "bus",
            })),
        )
        .await;
        return (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "id": route_id,
                "rx_id": body.rx_id,
                "tx_id": body.tx_id,
                "route_type": "bus"
            })),
        )
            .into_response();
    }
    let Some(rx) = parse_rx_id(&body.rx_id) else {
        return (StatusCode::BAD_REQUEST, "invalid rx_id").into_response();
    };
    let Some(tx) = parse_tx_id(&body.tx_id) else {
        return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response();
    };
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels || rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "channel index out of range").into_response();
    }
    if let Err(response) = ensure_routing_zone_scope(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only change routes in their own zone.",
    ) {
        return response;
    }
    cfg.matrix[tx][rx] = true;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":&body.rx_id,"tx_id":&body.tx_id,"state":"on","route_type":"dante"}).to_string());
    let route_id = format!("rx_{}|tx_{}", rx, tx);
    s.push_audit_log(
        "route.create",
        format!("Created route {route_id}."),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new("route", Some(route_id.clone()), None)),
        Some(serde_json::json!({
            "rx_id": body.rx_id,
            "tx_id": body.tx_id,
            "route_type": "dante",
        })),
    )
    .await;
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": route_id,
            "rx_id": body.rx_id,
            "tx_id": body.tx_id,
            "route_type": "dante"
        })),
    )
        .into_response()
}

// DELETE /api/v1/routes/:id — id is "rx_N|tx_M" (| may be URL-encoded as %7C)
#[utoipa::path(
    delete,
    path = "/api/v1/routes/{id}",
    tag = "routing",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "Route ID")),
    responses(
        (status = 204, description = "Route deleted"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn delete_route(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let parts: Vec<&str> = id.splitn(2, '|').collect();
    if parts.len() != 2 {
        return (
            StatusCode::BAD_REQUEST,
            "invalid route id — expected rx_N|tx_M",
        )
            .into_response();
    }
    // Handle bus→TX route: "bus_N|tx_M"
    if parts[0].starts_with("bus_") {
        let Some(b) = parse_bus_id(parts[0]) else {
            return (StatusCode::BAD_REQUEST, "invalid bus part in route id").into_response();
        };
        let Some(tx) = parse_tx_id(parts[1]) else {
            return (StatusCode::BAD_REQUEST, "invalid tx part in route id").into_response();
        };
        let mut cfg = s.config.write().await;
        if let Err(response) = ensure_routing_zone_scope(
            &cfg,
            claims.as_ref(),
            tx,
            "Zone-scoped users can only change routes in their own zone.",
        ) {
            return response;
        }
        if let Some(bm) = cfg.bus_matrix.as_mut() {
            if let Some(row) = bm.get_mut(tx) {
                if b < row.len() {
                    row[b] = false;
                }
            }
        }
        drop(cfg);
        crate::persist_or_500!(s);
        ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":format!("bus_{}",b),"tx_id":format!("tx_{}",tx),"state":"off","route_type":"bus"}).to_string());
        s.push_audit_log(
            "route.delete",
            format!("Deleted route {id}."),
            None,
            claims
                .as_ref()
                .map(|Extension(claims)| EventActor::from_claims(claims)),
            Some(EventResource::new("route", Some(id.clone()), None)),
            Some(serde_json::json!({
                "route_type": "bus",
            })),
        )
        .await;
        return StatusCode::NO_CONTENT.into_response();
    }
    let Some(rx) = parse_rx_id(parts[0]) else {
        return (StatusCode::BAD_REQUEST, "invalid rx part in route id").into_response();
    };
    let Some(tx) = parse_tx_id(parts[1]) else {
        return (StatusCode::BAD_REQUEST, "invalid tx part in route id").into_response();
    };
    let mut cfg = s.config.write().await;
    if tx >= cfg.tx_channels || rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "channel index out of range").into_response();
    }
    if let Err(response) = ensure_routing_zone_scope(
        &cfg,
        claims.as_ref(),
        tx,
        "Zone-scoped users can only change routes in their own zone.",
    ) {
        return response;
    }
    cfg.matrix[tx][rx] = false;
    drop(cfg);
    crate::persist_or_500!(s);
    ws_broadcast(&s, serde_json::json!({"type":"route_update","rx_id":format!("rx_{}",rx),"tx_id":format!("tx_{}",tx),"state":"off","route_type":"dante"}).to_string());
    s.push_audit_log(
        "route.delete",
        format!("Deleted route {id}."),
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new("route", Some(id.clone()), None)),
        Some(serde_json::json!({
            "route_type": "dante",
        })),
    )
    .await;
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/routes?rx_id=...&tx_id=...
pub async fn delete_routes_bulk(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;

    if let Some(zone_id) = params.get("zone_id") {
        if let Err(response) = auth_api::ensure_zone_scope_target(
            claims.as_ref(),
            zone_id,
            "Zone-scoped users can only clear routes in their own zone.",
        ) {
            return response;
        }
        let Some(zone) = cfg.zone_config.iter().find(|z| z.id == *zone_id) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let tx_ids = zone.tx_ids.clone();
        for tx_id in tx_ids {
            let Some(tx) = parse_tx_id(&tx_id) else {
                continue;
            };
            if let Some(row) = cfg.matrix.get_mut(tx) {
                for cell in row.iter_mut() {
                    *cell = false;
                }
            }
        }
        drop(cfg);
        crate::persist_or_500!(s);
        s.push_audit_log(
            "route.bulk_delete",
            format!("Cleared routes for zone {zone_id}."),
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
                "zone_id": zone_id,
            })),
        )
        .await;
        return StatusCode::NO_CONTENT.into_response();
    }

    match (params.get("rx_id"), params.get("tx_id")) {
        (Some(rx_id), Some(tx_id)) => {
            let Some(rx) = parse_rx_id(rx_id) else {
                return (StatusCode::BAD_REQUEST, "invalid rx_id").into_response();
            };
            let Some(tx) = parse_tx_id(tx_id) else {
                return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response();
            };
            if let Err(response) = ensure_routing_zone_scope(
                &cfg,
                claims.as_ref(),
                tx,
                "Zone-scoped users can only clear routes in their own zone.",
            ) {
                return response;
            }
            if tx < cfg.tx_channels && rx < cfg.rx_channels {
                cfg.matrix[tx][rx] = false;
            }
        }
        (Some(rx_id), None) => {
            if let Err(response) = auth_api::ensure_not_zone_scoped(
                claims.as_ref(),
                "Zone-scoped users must target a specific zone or output when clearing routes.",
            ) {
                return response;
            }
            let Some(rx) = parse_rx_id(rx_id) else {
                return (StatusCode::BAD_REQUEST, "invalid rx_id").into_response();
            };
            for row in cfg.matrix.iter_mut() {
                if rx < row.len() {
                    row[rx] = false;
                }
            }
        }
        (None, Some(tx_id)) => {
            let Some(tx) = parse_tx_id(tx_id) else {
                return (StatusCode::BAD_REQUEST, "invalid tx_id").into_response();
            };
            if let Err(response) = ensure_routing_zone_scope(
                &cfg,
                claims.as_ref(),
                tx,
                "Zone-scoped users can only clear routes in their own zone.",
            ) {
                return response;
            }
            if let Some(row) = cfg.matrix.get_mut(tx) {
                for cell in row.iter_mut() {
                    *cell = false;
                }
            }
        }
        (None, None) => {
            return (
                StatusCode::BAD_REQUEST,
                "specify rx_id, tx_id, zone_id, or a combination as query params",
            )
                .into_response();
        }
    }
    drop(cfg);
    crate::persist_or_500!(s);
    s.push_audit_log(
        "route.bulk_delete",
        "Cleared routes via bulk delete.",
        None,
        claims
            .as_ref()
            .map(|Extension(claims)| EventActor::from_claims(claims)),
        Some(EventResource::new("route", None, None)),
        Some(serde_json::json!({
            "rx_id": params.get("rx_id"),
            "tx_id": params.get("tx_id"),
        })),
    )
    .await;
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/vca-groups
pub async fn get_vca_groups(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(serde_json::json!({"vca_groups": cfg.vca_groups})).into_response()
}

// POST /api/v1/vca-groups
pub async fn post_vca_group(
    State(s): State<AppState>,
    Json(body): Json<CreateVcaRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let id = format!("vca_{}", cfg.vca_groups.len());
    let vca = patchbox_core::config::VcaGroupConfig {
        id: id.clone(),
        name: body.name,
        gain_db: body.gain_db,
        muted: false,
        members: body.members,
        group_type: body.group_type,
    };
    cfg.vca_groups.push(vca.clone());
    drop(cfg);
    let vca_groups = s.config.read().await.vca_groups.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"vca_updated","vca_groups":vca_groups}).to_string(),
    );
    (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response()
}

// PUT /api/v1/vca-groups/:id
pub async fn put_vca_group(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateVcaRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(vca) = cfg.vca_groups.iter_mut().find(|v| v.id == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(n) = body.name {
        vca.name = n;
    }
    if let Some(g) = body.gain_db {
        vca.gain_db = g.clamp(-60.0, 24.0);
    }
    if let Some(m) = body.muted {
        vca.muted = m;
    }
    if let Some(members) = body.members {
        vca.members = members;
    }
    drop(cfg);
    let vca_groups = s.config.read().await.vca_groups.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"vca_updated","vca_groups":vca_groups}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/vca-groups/:id
pub async fn delete_vca_group(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let before = cfg.vca_groups.len();
    cfg.vca_groups.retain(|v| v.id != id);
    if cfg.vca_groups.len() == before {
        return StatusCode::NOT_FOUND.into_response();
    }
    drop(cfg);
    let vca_groups = s.config.read().await.vca_groups.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"vca_updated","vca_groups":vca_groups}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/automixer-groups
pub async fn get_automixer_groups(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(serde_json::json!({"automixer_groups": cfg.automixer_groups})).into_response()
}

// POST /api/v1/automixer-groups
pub async fn post_automixer_group(
    State(s): State<AppState>,
    Json(body): Json<CreateAutomixerGroupRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let id = format!("amg_{}", cfg.automixer_groups.len());
    let group = patchbox_core::config::AutomixerGroupConfig {
        id: id.clone(),
        name: body.name,
        enabled: body.enabled,
        gating_enabled: body.gating_enabled,
        ..Default::default()
    };
    cfg.automixer_groups.push(group);
    drop(cfg);
    let groups = s.config.read().await.automixer_groups.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"automixer_updated","automixer_groups":groups}).to_string(),
    );
    (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response()
}

// PUT /api/v1/automixer-groups/:id
pub async fn put_automixer_group(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateAutomixerGroupRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(g) = cfg.automixer_groups.iter_mut().find(|g| g.id == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(n) = body.name {
        g.name = n;
    }
    if let Some(v) = body.enabled {
        g.enabled = v;
    }
    if let Some(v) = body.gate_threshold_db {
        g.gate_threshold_db = v.clamp(-80.0, 0.0);
    }
    if let Some(v) = body.off_attenuation_db {
        g.off_attenuation_db = v.clamp(-120.0, -1.0);
    }
    if let Some(v) = body.hold_ms {
        g.hold_ms = v.clamp(0.0, 5000.0);
    }
    if let Some(v) = body.last_mic_hold {
        g.last_mic_hold = v;
    }
    if let Some(v) = body.gating_enabled {
        g.gating_enabled = v;
    }
    drop(cfg);
    let groups = s.config.read().await.automixer_groups.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"automixer_updated","automixer_groups":groups}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/automixer-groups/:id
pub async fn delete_automixer_group(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let before = cfg.automixer_groups.len();
    cfg.automixer_groups.retain(|g| g.id != id);
    if cfg.automixer_groups.len() == before {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Remove channel memberships pointing to this group
    for dsp in cfg.input_dsp.iter_mut() {
        if dsp.automixer.group_id.as_deref() == Some(id.as_str()) {
            dsp.automixer.group_id = None;
        }
    }
    drop(cfg);
    let groups = s.config.read().await.automixer_groups.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"automixer_updated","automixer_groups":groups}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/stereo-links
pub async fn get_stereo_links(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(serde_json::json!({"stereo_links": cfg.stereo_links})).into_response()
}

// GET /api/v1/output-stereo-links
pub async fn get_output_stereo_links(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(serde_json::json!({"stereo_links": cfg.output_stereo_links})).into_response()
}

// POST /api/v1/stereo-links
pub async fn post_stereo_link(
    State(s): State<AppState>,
    Json(body): Json<CreateStereoLinkRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    cfg.stereo_links.retain(|sl| {
        sl.left_channel != body.left_channel && sl.right_channel != body.right_channel
    });
    cfg.stereo_links
        .push(patchbox_core::config::StereoLinkConfig {
            left_channel: body.left_channel,
            right_channel: body.right_channel,
            linked: true,
            pan: 0.0,
        });
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::CREATED.into_response()
}

// PUT /api/v1/stereo-links/:left_ch
pub async fn put_stereo_link(
    State(s): State<AppState>,
    Path(left_ch): Path<usize>,
    Json(body): Json<UpdateStereoLinkRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(sl) = cfg
        .stereo_links
        .iter_mut()
        .find(|sl| sl.left_channel == left_ch)
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(l) = body.linked {
        sl.linked = l;
    }
    if let Some(p) = body.pan {
        sl.pan = p.clamp(-1.0, 1.0);
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/stereo-links/:left_ch
pub async fn delete_stereo_link(
    State(s): State<AppState>,
    Path(left_ch): Path<usize>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let before = cfg.stereo_links.len();
    cfg.stereo_links.retain(|sl| sl.left_channel != left_ch);
    if cfg.stereo_links.len() == before {
        return StatusCode::NOT_FOUND.into_response();
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// POST /api/v1/output-stereo-links
pub async fn post_output_stereo_link(
    State(s): State<AppState>,
    Json(body): Json<CreateStereoLinkRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    cfg.output_stereo_links.retain(|sl| {
        sl.left_channel != body.left_channel
            && sl.right_channel != body.right_channel
            && sl.left_channel != body.right_channel
            && sl.right_channel != body.left_channel
    });
    cfg.output_stereo_links
        .push(patchbox_core::config::StereoLinkConfig {
            left_channel: body.left_channel,
            right_channel: body.right_channel,
            linked: true,
            pan: 0.0,
        });
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::CREATED.into_response()
}

// PUT /api/v1/output-stereo-links/:left_ch
pub async fn put_output_stereo_link(
    State(s): State<AppState>,
    Path(left_ch): Path<usize>,
    Json(body): Json<UpdateStereoLinkRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(sl) = cfg
        .output_stereo_links
        .iter_mut()
        .find(|sl| sl.left_channel == left_ch)
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(l) = body.linked {
        sl.linked = l;
    }
    if let Some(p) = body.pan {
        sl.pan = p.clamp(-1.0, 1.0);
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/output-stereo-links/:left_ch
pub async fn delete_output_stereo_link(
    State(s): State<AppState>,
    Path(left_ch): Path<usize>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let before = cfg.output_stereo_links.len();
    cfg.output_stereo_links
        .retain(|sl| sl.left_channel != left_ch);
    if cfg.output_stereo_links.len() == before {
        return StatusCode::NOT_FOUND.into_response();
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/signal-generators
pub async fn get_signal_generators(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(serde_json::json!({
        "signal_generators": cfg.signal_generators,
        "generator_bus_matrix": cfg.generator_bus_matrix,
    }))
    .into_response()
}

// POST /api/v1/signal-generators
pub async fn post_signal_generator(
    State(s): State<AppState>,
    Json(body): Json<CreateGeneratorRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let idx = cfg.signal_generators.len();
    let id = format!("gen_{}", idx);
    let new_gen = SignalGeneratorConfig {
        id: id.clone(),
        name: body.name,
        gen_type: body.gen_type,
        freq_hz: body.freq_hz,
        level_db: body.level_db,
        enabled: body.enabled,
        sweep_start_hz: body.sweep_start_hz,
        sweep_end_hz: body.sweep_end_hz,
        sweep_duration_s: body.sweep_duration_s,
    };
    cfg.signal_generators.push(new_gen.clone());
    cfg.normalize();
    drop(cfg);
    let generators = s.config.read().await.signal_generators.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"generators_updated","signal_generators":generators}).to_string(),
    );
    (StatusCode::CREATED, Json(new_gen)).into_response()
}

// PUT /api/v1/signal-generators/:id
pub async fn put_signal_generator(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateGeneratorRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(gen) = cfg.signal_generators.iter_mut().find(|g| g.id == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(n) = body.name {
        gen.name = n;
    }
    if let Some(t) = body.gen_type {
        gen.gen_type = t;
    }
    if let Some(f) = body.freq_hz {
        gen.freq_hz = f.clamp(20.0, 20000.0);
    }
    if let Some(l) = body.level_db {
        gen.level_db = l.clamp(-96.0, 0.0);
    }
    if let Some(e) = body.enabled {
        gen.enabled = e;
    }
    if let Some(s) = body.sweep_start_hz {
        gen.sweep_start_hz = s.clamp(20.0, 20000.0);
    }
    if let Some(s) = body.sweep_end_hz {
        gen.sweep_end_hz = s.clamp(20.0, 20000.0);
    }
    if let Some(d) = body.sweep_duration_s {
        gen.sweep_duration_s = d.clamp(0.1, 300.0);
    }
    drop(cfg);
    let generators = s.config.read().await.signal_generators.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"generators_updated","signal_generators":generators}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// DELETE /api/v1/signal-generators/:id
pub async fn delete_signal_generator(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let before = cfg.signal_generators.len();
    cfg.signal_generators.retain(|g| g.id != id);
    if cfg.signal_generators.len() == before {
        return StatusCode::NOT_FOUND.into_response();
    }
    cfg.normalize();
    drop(cfg);
    let generators = s.config.read().await.signal_generators.clone();
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({"type":"generators_updated","signal_generators":generators}).to_string(),
    );
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/signal-generators/:id/routing
pub async fn get_generator_routing(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let Some(idx) = cfg.signal_generators.iter().position(|g| g.id == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let gains = cfg
        .generator_bus_matrix
        .get(idx)
        .cloned()
        .unwrap_or_default();
    Json(serde_json::json!({"id": id, "gains": gains})).into_response()
}

// PUT /api/v1/signal-generators/:id/routing
pub async fn put_generator_routing(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateGeneratorMatrixRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    let Some(idx) = cfg.signal_generators.iter().position(|g| g.id == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    cfg.normalize();
    if let Some(row) = cfg.generator_bus_matrix.get_mut(idx) {
        for (tx_idx, &gain) in body.gains.iter().enumerate() {
            if let Some(cell) = row.get_mut(tx_idx) {
                *cell = gain;
            }
        }
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}
