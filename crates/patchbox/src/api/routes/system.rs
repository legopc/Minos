use crate::api::{linear_to_dbfs, ws_broadcast};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use patchbox_core::config::{InputChannelDsp, InternalBusConfig, PatchboxConfig};
use std::collections::HashMap;
use std::os::unix::fs::FileTypeExt;
use std::sync::atomic::Ordering as AOrdering;
use tokio::time::Duration;

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthDante {
    pub name: String,
    pub nic: String,
    pub connected: bool,
    pub rx_channels: usize,
    pub tx_channels: usize,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthPtp {
    pub synced: bool,
    pub socket_path: String,
    pub offset_ns: Option<i64>,
    pub state: Option<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthAudio {
    pub rx_channels: usize,
    pub tx_channels: usize,
    pub active_routes: usize,
    pub callbacks_total: u64,
    pub resyncs: u64,
    pub rx_levels_rms_db: Vec<f32>,
    pub tx_levels_rms_db: Vec<f32>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthZone {
    pub name: String,
    pub index: usize,
    pub muted: bool,
    pub gain_db: f32,
    pub eq_enabled: bool,
    pub limiter_enabled: bool,
    pub active_sources: Vec<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthConfig {
    pub loaded: bool,
    pub path: String,
    pub last_modified: Option<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthDsp {
    #[schema(value_type = String)]
    pub status: &'static str,
    pub cpu_percent: f32,
    pub cpu_percent_avg: f32,
    pub xruns: u64,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthStorage {
    pub free_bytes: u64,
    pub total_bytes: u64,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct HealthResponse {
    #[schema(value_type = String)]
    pub status: &'static str,
    #[schema(value_type = String)]
    pub version: &'static str,
    pub uptime_secs: u64,
    pub dante: HealthDante,
    pub ptp: HealthPtp,
    pub audio: HealthAudio,
    pub zones: Vec<HealthZone>,
    pub config: HealthConfig,
    pub dsp: HealthDsp,
    pub storage: HealthStorage,
    pub clients_connected: usize,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MeteringResponse {
    rx: HashMap<String, f32>,
    tx: HashMap<String, f32>,
    gr: HashMap<String, f32>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct SystemResponse {
    #[schema(value_type = String)]
    version: &'static str,
    hostname: String,
    uptime_s: u64,
    sample_rate: u32,
    rx_count: usize,
    tx_count: usize,
    zone_count: usize,
    dante_status: String,
    ptp_locked: bool,
    audio_drops: u64,
    bus_count: usize,
    show_buses_in_mixer: bool,
    monitor_device: Option<String>,
    monitor_volume_db: f32,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct UpdateSystemConfig {
    scene_crossfade_ms: Option<f32>,
    gain_ramp_ms: Option<f32>,
    show_buses_in_mixer: Option<bool>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct AdminChannelsReq {
    rx: usize,
    tx: usize,
    bus_count: Option<usize>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct SoloRequest {
    channels: Vec<usize>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct SoloResponse {
    channels: Vec<usize>,
    monitor_device: Option<String>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct MonitorRequest {
    device: Option<String>,
    #[serde(default)]
    volume_db: f32,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MonitorResponse {
    device: Option<String>,
    volume_db: f32,
}

fn linear_to_db(v: f32) -> f32 {
    if v <= 0.0 {
        return -60.0;
    }
    (20.0 * v.log10()).max(-60.0)
}

async fn query_ptp_offset(socket_path: &str) -> Option<i64> {
    use tokio::io::AsyncReadExt;
    let connect = tokio::net::UnixStream::connect(socket_path);
    let mut stream = tokio::time::timeout(Duration::from_millis(100), connect)
        .await
        .ok()?
        .ok()?;
    let mut buf = String::new();
    let read =
        tokio::time::timeout(Duration::from_millis(200), stream.read_to_string(&mut buf)).await;
    if read.is_err() {
        return None;
    }
    for line in buf.lines() {
        if line.starts_with("statime_offset_from_master") && !line.starts_with('#') {
            if let Some(val_str) = line.split_whitespace().last() {
                if let Ok(secs) = val_str.parse::<f64>() {
                    return Some((secs * 1_000_000_000.0) as i64);
                }
            }
        }
    }
    None
}

async fn query_ptp_state(socket_path: &str) -> Option<String> {
    use tokio::io::AsyncReadExt;
    let connect = tokio::net::UnixStream::connect(socket_path);
    let mut stream = tokio::time::timeout(Duration::from_millis(100), connect)
        .await
        .ok()?
        .ok()?;
    let mut buf = String::new();
    let read =
        tokio::time::timeout(Duration::from_millis(200), stream.read_to_string(&mut buf)).await;
    if read.is_err() {
        return None;
    }
    for line in buf.lines() {
        if line.starts_with("state") && !line.starts_with('#') {
            if let Some(val_str) = line.split_whitespace().last() {
                return Some(val_str.to_string());
            }
        }
    }
    None
}

fn get_hostname() -> String {
    std::fs::read_to_string("/etc/hostname")
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string()
}

async fn _create_backup(s: &AppState) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let cfg = s.config.read().await;
    let toml_str = toml::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
    drop(cfg);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let bak_path = s.config_path.with_file_name(format!(
        "{}-bak-{}.toml",
        s.config_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("patchbox"),
        ts
    ));
    std::fs::write(&bak_path, &toml_str).map_err(|e| e.to_string())?;
    if let Some(dir) = s.config_path.parent() {
        let stem = s
            .config_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("patchbox")
            .to_string();
        let mut baks: Vec<_> = std::fs::read_dir(dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name();
                let n = n.to_string_lossy();
                n.starts_with(&format!("{}-bak-", stem)) && n.ends_with(".toml")
            })
            .collect();
        baks.sort_by_key(|e| e.file_name());
        if baks.len() > 10 {
            for old in &baks[..baks.len() - 10] {
                let _ = std::fs::remove_file(old.path());
            }
        }
    }
    Ok(bak_path.to_string_lossy().into_owned())
}

// GET /api/v1/health
#[utoipa::path(
    get,
    path = "/api/v1/health",
    tag = "health",
    responses(
        (status = 200, description = "Health status", body = HealthResponse)
    )
)]
pub async fn get_health(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let meters = s.meters.read().await;

    // PTP checks
    let ptp_socket_path = cfg.dante_clock_path.clone();
    let ptp_synced = std::fs::metadata(&ptp_socket_path)
        .map(|m| m.file_type().is_socket())
        .unwrap_or(false);
    let ptp_offset_ns = if let Some(obs_path) = &cfg.statime_observation_path {
        query_ptp_offset(obs_path).await
    } else {
        None
    };
    let ptp_state = if let Some(obs_path) = &cfg.statime_observation_path {
        query_ptp_state(obs_path).await
    } else {
        None
    };

    // Config checks
    let config_loaded = true;
    let config_path_str = s.config_path.to_string_lossy().to_string();
    let config_last_modified = std::fs::metadata(&s.config_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| {
            use std::time::SystemTime;
            let duration = t.duration_since(SystemTime::UNIX_EPOCH).ok()?;
            let datetime = chrono::DateTime::from_timestamp(
                duration.as_secs() as i64,
                duration.subsec_nanos(),
            )?;
            Some(datetime.to_rfc3339())
        });

    // Storage checks (/opt/patchbox)
    let storage_path = "/opt/patchbox";
    let (storage_free_bytes, storage_total_bytes) =
        if let Ok(stat) = nix::sys::statvfs::statvfs(storage_path) {
            let block_size = stat.block_size();
            let free_bytes = stat.blocks_available() * block_size;
            let total_bytes = stat.blocks() * block_size;
            (free_bytes, total_bytes)
        } else {
            (0, 0)
        };

    // DSP metrics from shared atomic state
    let dsp_cpu_avg = s.dsp_metrics.cpu_percent_avg();
    let dsp = HealthDsp {
        status: s.dsp_metrics.status().as_str(),
        cpu_percent: s.dsp_metrics.cpu_percent_instant(),
        cpu_percent_avg: dsp_cpu_avg,
        xruns: s.dsp_metrics.xruns(),
    };

    // WS clients count - count active broadcast subscribers
    let clients_connected = s.ws_tx.receiver_count();

    // Dante info
    let dante_connected = s.dante_connected.load(AOrdering::Relaxed);
    let dante_rx_channels = cfg.rx_channels;
    let dante_tx_channels = cfg.tx_channels;

    // Audio info
    let active_routes = cfg.matrix.iter().flatten().filter(|&&v| v).count();
    let rx_levels_rms_db = meters.rx_rms.iter().map(|&v| linear_to_db(v)).collect();
    let tx_levels_rms_db = meters.tx_rms.iter().map(|&v| linear_to_db(v)).collect();

    // Zones
    let zones = (0..cfg.tx_channels)
        .map(|tx| {
            let active_sources = (0..cfg.rx_channels)
                .filter(|&rx| {
                    cfg.matrix
                        .get(tx)
                        .and_then(|row| row.get(rx))
                        .copied()
                        .unwrap_or(false)
                })
                .map(|rx| {
                    cfg.sources
                        .get(rx)
                        .cloned()
                        .unwrap_or_else(|| format!("Source {rx}"))
                })
                .collect();
            HealthZone {
                name: cfg
                    .zones
                    .get(tx)
                    .cloned()
                    .unwrap_or_else(|| format!("Zone {tx}")),
                index: tx,
                muted: cfg.output_muted.get(tx).copied().unwrap_or(false),
                gain_db: cfg.output_gain_db.get(tx).copied().unwrap_or(0.0),
                eq_enabled: cfg
                    .per_output_eq
                    .get(tx)
                    .map(|e| e.enabled)
                    .unwrap_or(false),
                limiter_enabled: cfg
                    .per_output_limiter
                    .get(tx)
                    .map(|l| l.enabled)
                    .unwrap_or(false),
                active_sources,
            }
        })
        .collect();

    // Determine health status
    let is_ptp_locked =
        ptp_state.as_deref() == Some("SLAVE") || ptp_state.as_deref() == Some("MASTER");
    let cpu_load_ok = dsp_cpu_avg < 90.0;
    let storage_free_ok = storage_free_bytes > 50 * 1024 * 1024; // 50 MiB

    let status = if !dante_connected || !config_loaded || !storage_free_ok {
        "unhealthy"
    } else if !is_ptp_locked || !cpu_load_ok {
        "degraded"
    } else {
        "healthy"
    };

    Json(HealthResponse {
        status,
        version: env!("CARGO_PKG_VERSION"),
        uptime_secs: s.started_at.elapsed().as_secs(),
        dante: HealthDante {
            name: cfg.dante_name.clone(),
            nic: cfg.dante_nic.clone(),
            connected: dante_connected,
            rx_channels: dante_rx_channels,
            tx_channels: dante_tx_channels,
        },
        ptp: HealthPtp {
            synced: ptp_synced,
            socket_path: cfg.dante_clock_path.clone(),
            offset_ns: ptp_offset_ns,
            state: ptp_state,
        },
        audio: HealthAudio {
            rx_channels: cfg.rx_channels,
            tx_channels: cfg.tx_channels,
            active_routes,
            callbacks_total: s.audio_callbacks.load(AOrdering::Relaxed),
            resyncs: s.resyncs.load(AOrdering::Relaxed),
            rx_levels_rms_db,
            tx_levels_rms_db,
        },
        zones,
        config: HealthConfig {
            loaded: config_loaded,
            path: config_path_str,
            last_modified: config_last_modified,
        },
        dsp,
        storage: HealthStorage {
            free_bytes: storage_free_bytes,
            total_bytes: storage_total_bytes,
        },
        clients_connected,
    })
}

// GET /api/v1/metering
pub async fn get_metering(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let rx_count = cfg.rx_channels;
    let tx_count = cfg.tx_channels;
    drop(cfg);
    let meters = s.meters.read().await;
    let rx: HashMap<String, f32> = (0..rx_count)
        .map(|i| {
            (
                format!("rx_{}", i),
                meters
                    .rx_rms
                    .get(i)
                    .copied()
                    .map(linear_to_dbfs)
                    .unwrap_or(-60.0),
            )
        })
        .collect();
    let tx: HashMap<String, f32> = (0..tx_count)
        .map(|i| {
            (
                format!("tx_{}", i),
                meters
                    .tx_rms
                    .get(i)
                    .copied()
                    .map(linear_to_dbfs)
                    .unwrap_or(-60.0),
            )
        })
        .collect();
    let gr: HashMap<String, f32> = (0..tx_count)
        .map(|i| {
            (
                format!("tx_{}", i),
                meters.tx_gr_db.get(i).copied().unwrap_or(0.0),
            )
        })
        .collect();
    Json(MeteringResponse { rx, tx, gr })
}

// GET /api/v1/system
#[utoipa::path(
    get,
    path = "/api/v1/system",
    tag = "system",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "System info", body = SystemResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_system(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let zone_count = cfg.zone_config.len();
    let rx_count = cfg.rx_channels;
    let tx_count = cfg.tx_channels;
    let bus_count = cfg.internal_buses.len();
    let show_buses_in_mixer = cfg.show_buses_in_mixer;
    let monitor_device = cfg.monitor_device.clone();
    let monitor_volume_db = cfg.monitor_volume_db;
    drop(cfg);
    let dante_connected = s.dante_connected.load(AOrdering::Relaxed);
    let ptp_locked = dante_connected;
    let dante_status = if dante_connected {
        "connected"
    } else {
        "disconnected"
    }
    .to_string();
    Json(SystemResponse {
        version: env!("CARGO_PKG_VERSION"),
        hostname: get_hostname(),
        uptime_s: s.started_at.elapsed().as_secs(),
        sample_rate: 48000,
        rx_count,
        tx_count,
        zone_count,
        dante_status,
        ptp_locked,
        audio_drops: s.resyncs.load(AOrdering::Relaxed),
        bus_count,
        show_buses_in_mixer,
        monitor_device,
        monitor_volume_db,
    })
}

// PUT /api/v1/system/config
pub async fn put_system_config(
    State(s): State<AppState>,
    Json(body): Json<UpdateSystemConfig>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if let Some(v) = body.scene_crossfade_ms {
        cfg.scene_crossfade_ms = v.max(0.0);
    }
    if let Some(v) = body.gain_ramp_ms {
        cfg.gain_ramp_ms = v.clamp(0.0, 5000.0);
    }
    if let Some(v) = body.show_buses_in_mixer {
        cfg.show_buses_in_mixer = v;
    }
    drop(cfg);
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/system/config/export
pub async fn get_system_config_export(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    match toml::to_string_pretty(&*cfg) {
        Ok(toml_str) => (
            [
                (header::CONTENT_TYPE, "application/toml"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=\"patchbox.toml\"",
                ),
            ],
            toml_str,
        )
            .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// POST /api/v1/system/config/import
pub async fn post_system_config_import(
    State(s): State<AppState>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let toml_str = match std::str::from_utf8(&body) {
        Ok(s) => s,
        Err(_) => return (StatusCode::BAD_REQUEST, "body is not valid UTF-8").into_response(),
    };
    let mut new_cfg: PatchboxConfig = match toml::from_str(toml_str) {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
    let _ = _create_backup(&s).await;
    new_cfg.normalize();
    *s.config.write().await = new_cfg;
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/system/config/backups
pub async fn get_config_backups(State(s): State<AppState>) -> impl IntoResponse {
    let stem = s
        .config_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("patchbox")
        .to_string();
    let dir = match s.config_path.parent() {
        Some(d) => d,
        None => return Json(serde_json::json!([])).into_response(),
    };
    let mut baks: Vec<serde_json::Value> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            n.starts_with(&format!("{}-bak-", stem)) && n.ends_with(".toml")
        })
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let ts: u64 = name
                .strip_prefix(&format!("{}-bak-", stem))
                .and_then(|s| s.strip_suffix(".toml"))
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            serde_json::json!({ "name": name, "timestamp": ts })
        })
        .collect();
    baks.sort_by(|a, b| b["timestamp"].as_u64().cmp(&a["timestamp"].as_u64()));
    Json(baks).into_response()
}

// GET /api/v1/system/config/backups/:name
pub async fn get_config_backup(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if name.contains('/') || name.contains("..") {
        return (StatusCode::BAD_REQUEST, "invalid backup name").into_response();
    }
    let dir = match s.config_path.parent() {
        Some(d) => d,
        None => return StatusCode::NOT_FOUND.into_response(),
    };
    let path = dir.join(&name);
    match std::fs::read_to_string(&path) {
        Ok(content) => (
            [
                (header::CONTENT_TYPE, "application/toml"),
                (
                    header::CONTENT_DISPOSITION,
                    &format!("attachment; filename=\"{name}\"") as &str,
                ),
            ],
            content,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// POST /api/v1/system/config/backups/:name/restore
pub async fn restore_config_backup(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if name.contains('/') || name.contains("..") {
        return (StatusCode::BAD_REQUEST, "invalid backup name").into_response();
    }
    let dir = match s.config_path.parent() {
        Some(d) => d,
        None => return StatusCode::NOT_FOUND.into_response(),
    };
    let path = dir.join(&name);
    let toml_str = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let mut new_cfg: PatchboxConfig = match toml::from_str(&toml_str) {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
    let _ = _create_backup(&s).await;
    new_cfg.normalize();
    *s.config.write().await = new_cfg;
    crate::persist_or_500!(s);
    StatusCode::NO_CONTENT.into_response()
}

// GET /api/v1/system/config/backup
#[utoipa::path(
    get,
    path = "/api/v1/system/config/backup",
    tag = "system",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Current config as TOML file download",
         content_type = "application/toml"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 500, description = "Serialisation error", body = crate::api::ErrorResponse),
    )
)]
pub async fn get_config_backup_download(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let toml_str = match toml::to_string_pretty(&*cfg) {
        Ok(s) => s,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
    };
    drop(cfg);

    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let filename = format!("patchbox-config-{date}.toml");
    let disposition = format!("attachment; filename=\"{filename}\"");

    (
        [
            (header::CONTENT_TYPE, "application/toml".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        toml_str,
    )
        .into_response()
}

// GET /api/v1/solo
#[utoipa::path(
    get,
    path = "/api/v1/solo",
    tag = "system",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Current solo state", body = SoloResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_solo(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(SoloResponse {
        channels: cfg.solo_channels.clone(),
        monitor_device: cfg.monitor_device.clone(),
    })
}

// PUT /api/v1/solo
#[utoipa::path(
    put,
    path = "/api/v1/solo",
    tag = "system",
    security(("bearer_auth" = [])),
    request_body = SoloRequest,
    responses(
        (status = 204, description = "Solo updated"),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn put_solo(
    State(s): State<AppState>,
    Json(body): Json<SoloRequest>,
) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    cfg.solo_channels = body
        .channels
        .into_iter()
        .filter(|&rx| rx < cfg.rx_channels)
        .collect();
    cfg.solo_channels.sort_unstable();
    cfg.solo_channels.dedup();
    let resp = SoloResponse {
        channels: cfg.solo_channels.clone(),
        monitor_device: cfg.monitor_device.clone(),
    };
    ws_broadcast(
        &s,
        serde_json::json!({
            "type": "solo_update",
            "channels": &resp.channels,
            "monitor_device": &resp.monitor_device,
        })
        .to_string(),
    );
    StatusCode::NO_CONTENT
}

// POST /api/v1/solo/:rx/toggle
pub async fn toggle_solo(State(s): State<AppState>, Path(rx): Path<usize>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    if rx >= cfg.rx_channels {
        return (StatusCode::BAD_REQUEST, "Invalid RX index").into_response();
    }
    if let Some(pos) = cfg.solo_channels.iter().position(|&c| c == rx) {
        cfg.solo_channels.remove(pos);
    } else {
        cfg.solo_channels.push(rx);
        cfg.solo_channels.sort_unstable();
    }
    let resp = SoloResponse {
        channels: cfg.solo_channels.clone(),
        monitor_device: cfg.monitor_device.clone(),
    };
    ws_broadcast(
        &s,
        serde_json::json!({
            "type": "solo_update",
            "channels": &resp.channels,
            "monitor_device": &resp.monitor_device,
        })
        .to_string(),
    );
    Json(resp).into_response()
}

// DELETE /api/v1/solo
pub async fn delete_solo(State(s): State<AppState>) -> impl IntoResponse {
    let mut cfg = s.config.write().await;
    cfg.solo_channels.clear();
    ws_broadcast(
        &s,
        serde_json::json!({
            "type": "solo_update",
            "channels": Vec::<usize>::new(),
            "monitor_device": &cfg.monitor_device,
        })
        .to_string(),
    );
    StatusCode::NO_CONTENT
}

// GET /api/v1/monitor
#[utoipa::path(
    get,
    path = "/api/v1/system/monitor",
    tag = "system",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Monitor state", body = MonitorResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_monitor(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    Json(MonitorResponse {
        device: cfg.monitor_device.clone(),
        volume_db: cfg.monitor_volume_db,
    })
}

// PUT /api/v1/monitor
#[utoipa::path(
    put,
    path = "/api/v1/system/monitor",
    tag = "system",
    security(("bearer_auth" = [])),
    request_body = MonitorRequest,
    responses(
        (status = 200, description = "Monitor updated", body = MonitorResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn put_monitor(
    State(s): State<AppState>,
    Json(body): Json<MonitorRequest>,
) -> impl IntoResponse {
    if body.volume_db < -60.0 || body.volume_db > 12.0 {
        return (StatusCode::BAD_REQUEST, "volume_db out of range [-60, 12]").into_response();
    }
    {
        let mut cfg = s.config.write().await;
        cfg.monitor_device = body.device.clone();
        cfg.monitor_volume_db = body.volume_db;
    }
    crate::persist_or_500!(s);
    ws_broadcast(
        &s,
        serde_json::json!({
            "type": "monitor_config_update",
            "device": &body.device,
            "volume_db": body.volume_db,
        })
        .to_string(),
    );
    Json(MonitorResponse {
        device: body.device,
        volume_db: body.volume_db,
    })
    .into_response()
}

// GET /api/v1/audio-devices
pub async fn list_audio_devices() -> impl IntoResponse {
    #[cfg(feature = "inferno")]
    {
        let devs = patchbox_dante::monitor::enumerate_devices();
        let list: Vec<serde_json::Value> = devs
            .iter()
            .map(|(name, desc)| serde_json::json!({ "name": name, "description": desc }))
            .collect();
        return Json(serde_json::json!({ "devices": list })).into_response();
    }
    #[cfg(not(feature = "inferno"))]
    Json(serde_json::json!({ "devices": [] })).into_response()
}

// GET /api/v1/whoami
pub async fn whoami(State(_s): State<AppState>, req: axum::extract::Request) -> impl IntoResponse {
    let claims = req.extensions().get::<crate::jwt::Claims>().cloned();
    match claims {
        Some(c) => Json(serde_json::json!({"username": c.sub, "role": c.role, "zone": c.zone}))
            .into_response(),
        None => (StatusCode::UNAUTHORIZED, "not authenticated").into_response(),
    }
}

// POST /api/v1/admin/channels
pub async fn post_admin_channels(
    State(state): State<AppState>,
    Json(body): Json<AdminChannelsReq>,
) -> impl IntoResponse {
    if body.rx < 1 || body.rx > 32 || body.tx < 1 || body.tx > 32 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "channel count out of range (1-32)"})),
        )
            .into_response();
    }
    {
        let mut cfg = state.config.write().await;
        cfg.rx_channels = body.rx;
        cfg.tx_channels = body.tx;
        if let Some(count) = body.bus_count {
            let count = count.min(8);
            let rx = cfg.rx_channels;
            while cfg.internal_buses.len() < count {
                let idx = cfg.internal_buses.len();
                cfg.internal_buses.push(InternalBusConfig {
                    id: format!("bus_{}", idx),
                    name: format!("Bus {}", idx + 1),
                    routing: vec![false; rx],
                    routing_gain: vec![0.0; rx],
                    dsp: InputChannelDsp::default(),
                    muted: false,
                });
            }
            cfg.internal_buses.truncate(count);
        }
        cfg.normalize();
    }
    if let Err(e) = state.persist().await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("persist failed: {}", e)})),
        )
            .into_response();
    }
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        std::process::exit(0);
    });
    (
        StatusCode::OK,
        Json(serde_json::json!({"ok": true, "restarting": true})),
    )
        .into_response()
}

// POST /api/v1/admin/restart
pub async fn post_admin_restart(State(state): State<AppState>) -> impl IntoResponse {
    let _ = state.persist().await;
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        std::process::exit(0);
    });
    (
        StatusCode::OK,
        Json(serde_json::json!({"ok": true, "restarting": true})),
    )
        .into_response()
}
