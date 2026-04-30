use crate::api::{
    linear_to_dbfs, parse_tx_id, parse_zone_id, parse_zone_template_id, ws_broadcast,
};
use crate::auth_api;
use crate::ptp::{is_ptp_locked_state, query_ptp_offset, query_ptp_state};
use crate::state::{
    AppState, EventActor, EventLogEntry, EventResource, PtpHistorySample, TaskEvent, TaskStatus,
};
use axum::{
    extract::{Extension, Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use patchbox_core::config::{
    InputChannelDsp, InternalBusConfig, PatchboxConfig, ZoneTemplateConfig,
};
use std::collections::{BTreeSet, HashMap};
use std::os::unix::fs::FileTypeExt;
use std::path::{Path as FsPath, PathBuf};
use std::sync::atomic::Ordering as AOrdering;

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
pub struct MetricsDante {
    pub connected: bool,
    pub rx_channels: usize,
    pub tx_channels: usize,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MetricsPtp {
    pub synced: bool,
    pub offset_ns: Option<i64>,
    pub state: Option<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MetricsAudio {
    pub active_routes: usize,
    pub callbacks_total: u64,
    pub resyncs: u64,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MetricsDsp {
    #[schema(value_type = String)]
    pub status: &'static str,
    pub cpu_percent: f32,
    pub cpu_percent_avg: f32,
    pub xruns: u64,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MetricsStorage {
    pub free_bytes: u64,
    pub total_bytes: u64,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MetricsResponse {
    #[schema(value_type = String)]
    pub status: &'static str,
    #[schema(value_type = String)]
    pub version: &'static str,
    pub uptime_secs: u64,
    pub clients_connected: usize,
    pub dante: MetricsDante,
    pub ptp: MetricsPtp,
    pub audio: MetricsAudio,
    pub dsp: MetricsDsp,
    pub storage: MetricsStorage,
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
    ptp_state: Option<String>,
    ptp_offset_ns: Option<i64>,
    audio_drops: u64,
    bus_count: usize,
    show_buses_in_mixer: bool,
    monitor_device: Option<String>,
    monitor_volume_db: f32,
}

// Sprint 6 Phase 1 foundation — Dante diagnostics endpoint
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticLevel {
    Ok,
    Warn,
    Error,
    Unknown,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DiagnosticItem {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DiagnosticCard {
    pub level: DiagnosticLevel,
    pub summary: String,
    pub items: Vec<DiagnosticItem>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DanteSubscriptionState {
    Active,
    RoutedSilent,
    Unrouted,
    Muted,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DanteSubscriptionStatus {
    pub output_id: String,
    pub output_name: String,
    pub zone_id: String,
    pub state: DanteSubscriptionState,
    pub level: DiagnosticLevel,
    pub estimated: bool,
    pub route_count: usize,
    pub signal_present: bool,
    pub tx_level_dbfs: f32,
    pub sources: Vec<String>,
    pub summary: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DanteEndpointKind {
    Input,
    Output,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DanteEndpointRosterEntry {
    pub id: String,
    pub kind: DanteEndpointKind,
    pub name: String,
    pub level: DiagnosticLevel,
    pub estimated: bool,
    pub linked_count: usize,
    pub signal_present: bool,
    pub level_dbfs: f32,
    pub summary: String,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DanteDiagnosticsResponse {
    pub event_log: Vec<crate::state::EventLogEntry>,
    pub generated_at: String,
    pub device: DiagnosticCard,
    pub network: DiagnosticCard,
    pub ptp: DiagnosticCard,
    pub ptp_history: Vec<PtpHistorySample>,
    pub roster: Vec<DanteEndpointRosterEntry>,
    pub subscriptions: Vec<DanteSubscriptionStatus>,
    pub recovery_actions: Vec<DanteRecoveryAction>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DanteRecoveryActionId {
    Rescan,
    Rebind,
    Restart,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DanteRecoveryAction {
    pub id: DanteRecoveryActionId,
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DanteRecoveryActionResponse {
    pub ok: bool,
    pub action: DanteRecoveryActionId,
    pub message: String,
    pub restarting: bool,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConfigDiffKind {
    Added,
    Removed,
    Changed,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ConfigDiffEntry {
    pub path: String,
    pub kind: ConfigDiffKind,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, utoipa::ToSchema)]
pub struct ConfigDiffSummary {
    pub description: String,
    pub total_changes: usize,
    pub changed: usize,
    pub added: usize,
    pub removed: usize,
    pub top_level_fields: Vec<String>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, serde::Serialize, utoipa::ToSchema)]
pub struct ConfigValidateResponse {
    pub valid: bool,
    pub normalized: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<ConfigCompatibilityWarning>,
    pub summary: ConfigDiffSummary,
    pub changes: Vec<ConfigDiffEntry>,
}

#[derive(Clone, Debug, Default, serde::Serialize, utoipa::ToSchema)]
pub struct ConfigCompatibilityWarning {
    pub code: String,
    pub summary: String,
    pub details: Vec<String>,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    serde::Serialize,
    serde::Deserialize,
    utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum BackupSource {
    Import,
    Restore,
    BackupRestore,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct BackupMetadata {
    pub has_metadata: bool,
    pub created_at: Option<String>,
    pub source: BackupSource,
    pub version: Option<String>,
    pub requested_by: Option<String>,
    pub note: Option<String>,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct BackupListEntry {
    pub name: String,
    pub timestamp: u64,
    pub metadata: BackupMetadata,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct AuditLogResponse {
    pub total: usize,
    pub entries: Vec<EventLogEntry>,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct AuditExportResponse {
    pub exported_at: String,
    pub total: usize,
    pub entries: Vec<EventLogEntry>,
}

#[derive(Clone, Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum BulkMutationRequest {
    SetAllOutputsMuted {
        muted: bool,
    },
    SetZoneOutputsMuted {
        zone_id: String,
        muted: bool,
    },
    ApplyZoneTemplate {
        zone_id: String,
        template_id: String,
    },
    ClearZoneRoutes {
        zone_id: String,
    },
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct BulkMutationResponse {
    pub ok: bool,
    pub operation: String,
    pub affected: usize,
    pub task_id: String,
}

fn set_output_muted_state(cfg: &mut PatchboxConfig, tx: usize, muted: bool) -> bool {
    let mut changed = false;

    if let Some(current) = cfg.output_muted.get(tx).copied() {
        if current != muted {
            changed = true;
        }
    }
    if let Some(current) = cfg.output_dsp.get(tx).map(|dsp| dsp.muted) {
        if current != muted {
            changed = true;
        }
    }

    if let Some(value) = cfg.output_muted.get_mut(tx) {
        *value = muted;
    }
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.muted = muted;
    }

    changed
}

fn apply_zone_template_to_output(
    cfg: &mut PatchboxConfig,
    tx: usize,
    template: &ZoneTemplateConfig,
) {
    let gain_db = template.output.gain_db.clamp(-60.0, 24.0);
    let muted = template.output.muted;
    let eq = template.output.eq.clone();
    let limiter = template.output.limiter.clone();

    if let Some(value) = cfg.output_gain_db.get_mut(tx) {
        *value = gain_db;
    }
    if let Some(value) = cfg.output_muted.get_mut(tx) {
        *value = muted;
    }
    if let Some(value) = cfg.per_output_eq.get_mut(tx) {
        *value = eq.clone();
    }
    if let Some(value) = cfg.per_output_limiter.get_mut(tx) {
        *value = limiter.clone();
    }
    if let Some(dsp) = cfg.output_dsp.get_mut(tx) {
        dsp.gain_db = gain_db;
        dsp.muted = muted;
        dsp.eq = eq;
        dsp.limiter = limiter;
    }
}

fn linear_to_db(v: f32) -> f32 {
    if v <= 0.0 {
        return -60.0;
    }
    (20.0 * v.log10()).max(-60.0)
}

const MAX_CONFIG_DIFF_ENTRIES: usize = 64;

fn get_hostname() -> String {
    std::fs::read_to_string("/etc/hostname")
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string()
}

fn dante_recovery_actions() -> Vec<DanteRecoveryAction> {
    vec![
        DanteRecoveryAction {
            id: DanteRecoveryActionId::Rescan,
            label: "Rescan now".to_string(),
            description: "Capture a fresh Dante/PTP sample and append it to history.".to_string(),
        },
        DanteRecoveryAction {
            id: DanteRecoveryActionId::Rebind,
            label: "Rebind runtime".to_string(),
            description: "Reload config from disk without a full restart.".to_string(),
        },
        DanteRecoveryAction {
            id: DanteRecoveryActionId::Restart,
            label: "Restart Minos".to_string(),
            description: "Persist config and restart the service.".to_string(),
        },
    ]
}

fn dante_output_identity(cfg: &PatchboxConfig, tx: usize) -> (String, String, Option<String>, u8) {
    let tx_id = format!("tx_{}", tx);
    let zone = cfg
        .zone_config
        .iter()
        .find(|z| z.tx_ids.iter().any(|candidate| candidate == &tx_id));
    let output_name = zone.map(|z| z.name.clone()).unwrap_or_else(|| {
        cfg.zones
            .get(tx)
            .cloned()
            .unwrap_or_else(|| format!("Zone {}", tx + 1))
    });
    let zone_id = zone
        .map(|z| z.id.clone())
        .unwrap_or_else(|| format!("zone_{}", tx));
    let zone_name = zone.map(|z| z.name.clone());
    let zone_colour_index = zone.map(|z| z.colour_index).unwrap_or((tx % 10) as u8);
    (output_name, zone_id, zone_name, zone_colour_index)
}

fn build_dante_subscription_statuses(
    cfg: &PatchboxConfig,
    meters: &crate::state::MeterState,
) -> Vec<DanteSubscriptionStatus> {
    (0..cfg.tx_channels)
        .map(|tx| {
            let output_id = format!("tx_{}", tx);
            let (output_name, zone_id, _zone_name, _zone_colour_index) =
                dante_output_identity(cfg, tx);

            let mut sources = Vec::new();
            if let Some(row) = cfg.matrix.get(tx) {
                for (rx, enabled) in row.iter().enumerate() {
                    if *enabled {
                        sources.push(format!("Input {}", rx + 1));
                    }
                }
            }
            if let Some(bus_matrix) = cfg.bus_matrix.as_ref().and_then(|matrix| matrix.get(tx)) {
                for (bus_idx, enabled) in bus_matrix.iter().enumerate() {
                    if *enabled {
                        let label = cfg
                            .internal_buses
                            .get(bus_idx)
                            .map(|bus| bus.name.clone())
                            .unwrap_or_else(|| format!("Bus {}", bus_idx + 1));
                        sources.push(label);
                    }
                }
            }
            for (gen_idx, row) in cfg.generator_bus_matrix.iter().enumerate() {
                let routed = row
                    .get(tx)
                    .copied()
                    .unwrap_or(f32::NEG_INFINITY)
                    .is_finite();
                if routed {
                    let label = cfg
                        .signal_generators
                        .get(gen_idx)
                        .map(|generator| generator.name.clone())
                        .unwrap_or_else(|| format!("Generator {}", gen_idx + 1));
                    sources.push(label);
                }
            }

            let route_count = sources.len();
            let dsp = cfg.output_dsp.get(tx).cloned().unwrap_or_default();
            let tx_level_dbfs = linear_to_dbfs(meters.tx_rms.get(tx).copied().unwrap_or_default());
            let signal_present = tx_level_dbfs > -55.0;
            let (state, level, summary) = if route_count == 0 {
                (
                    DanteSubscriptionState::Unrouted,
                    DiagnosticLevel::Unknown,
                    "No routed sources.".to_string(),
                )
            } else if dsp.muted {
                (
                    DanteSubscriptionState::Muted,
                    DiagnosticLevel::Warn,
                    format!("{route_count} routed source(s), but output is muted."),
                )
            } else if signal_present {
                (
                    DanteSubscriptionState::Active,
                    DiagnosticLevel::Ok,
                    format!("{route_count} routed source(s) carrying signal."),
                )
            } else {
                (
                    DanteSubscriptionState::RoutedSilent,
                    DiagnosticLevel::Warn,
                    format!("{route_count} routed source(s), but no output signal detected."),
                )
            };

            DanteSubscriptionStatus {
                output_id,
                output_name,
                zone_id,
                state,
                level,
                estimated: true,
                route_count,
                signal_present,
                tx_level_dbfs,
                sources,
                summary,
            }
        })
        .collect()
}

fn build_dante_endpoint_roster(
    cfg: &PatchboxConfig,
    meters: &crate::state::MeterState,
) -> Vec<DanteEndpointRosterEntry> {
    let mut entries = Vec::with_capacity(cfg.rx_channels + cfg.tx_channels);

    for rx in 0..cfg.rx_channels {
        let input_name = cfg
            .sources
            .get(rx)
            .cloned()
            .unwrap_or_else(|| format!("Source {}", rx + 1));
        let output_routes = cfg
            .matrix
            .iter()
            .filter(|row| row.get(rx).copied().unwrap_or(false))
            .count();
        let bus_routes = cfg
            .internal_buses
            .iter()
            .filter(|bus| bus.routing.get(rx).copied().unwrap_or(false))
            .count();
        let linked_count = output_routes + bus_routes;
        let level_dbfs = linear_to_dbfs(meters.rx_rms.get(rx).copied().unwrap_or_default());
        let signal_present = level_dbfs > -55.0;
        let (level, summary) = if linked_count == 0 && !signal_present {
            (
                DiagnosticLevel::Unknown,
                "Idle input with no active destinations.".to_string(),
            )
        } else if linked_count == 0 {
            (
                DiagnosticLevel::Unknown,
                "Signal present, but nothing is currently routed from this input.".to_string(),
            )
        } else if signal_present {
            (
                DiagnosticLevel::Ok,
                format!("Feeds {linked_count} destination(s) and carries signal."),
            )
        } else {
            (
                DiagnosticLevel::Warn,
                format!("Feeds {linked_count} destination(s), but no input signal is detected."),
            )
        };

        entries.push(DanteEndpointRosterEntry {
            id: format!("rx_{}", rx),
            kind: DanteEndpointKind::Input,
            name: input_name,
            level,
            estimated: true,
            linked_count,
            signal_present,
            level_dbfs,
            summary,
        });
    }

    for tx in 0..cfg.tx_channels {
        let (output_name, _zone_id, _zone_name, _zone_colour_index) =
            dante_output_identity(cfg, tx);
        let linked_count = cfg
            .matrix
            .get(tx)
            .map(|row| row.iter().filter(|enabled| **enabled).count())
            .unwrap_or(0)
            + cfg
                .bus_matrix
                .as_ref()
                .and_then(|matrix| matrix.get(tx))
                .map(|row| row.iter().filter(|enabled| **enabled).count())
                .unwrap_or(0)
            + cfg
                .generator_bus_matrix
                .iter()
                .filter(|row| {
                    row.get(tx)
                        .copied()
                        .unwrap_or(f32::NEG_INFINITY)
                        .is_finite()
                })
                .count();
        let dsp = cfg.output_dsp.get(tx).cloned().unwrap_or_default();
        let level_dbfs = linear_to_dbfs(meters.tx_rms.get(tx).copied().unwrap_or_default());
        let signal_present = level_dbfs > -55.0;
        let (level, summary) = if linked_count == 0 {
            (
                DiagnosticLevel::Unknown,
                "No active sources routed to this output.".to_string(),
            )
        } else if dsp.muted {
            (
                DiagnosticLevel::Warn,
                format!("{linked_count} routed source(s), but the output is muted."),
            )
        } else if signal_present {
            (
                DiagnosticLevel::Ok,
                format!("{linked_count} routed source(s) are feeding this output."),
            )
        } else {
            (
                DiagnosticLevel::Warn,
                format!("{linked_count} routed source(s), but no output signal is detected."),
            )
        };

        entries.push(DanteEndpointRosterEntry {
            id: format!("tx_{}", tx),
            kind: DanteEndpointKind::Output,
            name: output_name,
            level,
            estimated: true,
            linked_count,
            signal_present,
            level_dbfs,
            summary,
        });
    }

    entries
}

fn build_config_validate_warnings(
    current: &PatchboxConfig,
    candidate: &PatchboxConfig,
) -> Vec<ConfigCompatibilityWarning> {
    let mut warnings = Vec::new();

    if candidate.rx_channels < current.rx_channels {
        let direct_routes = current
            .matrix
            .iter()
            .map(|row| {
                row.iter()
                    .skip(candidate.rx_channels)
                    .filter(|enabled| **enabled)
                    .count()
            })
            .sum::<usize>();
        let bus_inputs = current
            .internal_buses
            .iter()
            .map(|bus| {
                bus.routing
                    .iter()
                    .skip(candidate.rx_channels)
                    .filter(|enabled| **enabled)
                    .count()
            })
            .sum::<usize>();
        let removed_links = current
            .stereo_links
            .iter()
            .filter(|link| {
                link.left_channel >= candidate.rx_channels
                    || link.right_channel >= candidate.rx_channels
            })
            .count();
        let mut details = vec![format!(
            "RX channels shrink from {} to {}.",
            current.rx_channels, candidate.rx_channels
        )];
        if direct_routes > 0 {
            details.push(format!(
                "{direct_routes} direct output route(s) currently reference inputs that would be removed."
            ));
        }
        if bus_inputs > 0 {
            details.push(format!(
                "{bus_inputs} bus input feed(s) currently reference inputs that would be removed."
            ));
        }
        if removed_links > 0 {
            details.push(format!(
                "{removed_links} stereo input link(s) reference channels outside the new RX range."
            ));
        }
        warnings.push(ConfigCompatibilityWarning {
            code: "rx_shrink".to_string(),
            summary: "Input-count shrink can orphan live sources and input-linked DSP.".to_string(),
            details,
        });
    }

    if candidate.tx_channels < current.tx_channels {
        let direct_routes = current
            .matrix
            .iter()
            .skip(candidate.tx_channels)
            .map(|row| row.iter().filter(|enabled| **enabled).count())
            .sum::<usize>();
        let bus_routes = current
            .bus_matrix
            .as_ref()
            .map(|matrix| {
                matrix
                    .iter()
                    .skip(candidate.tx_channels)
                    .map(|row| row.iter().filter(|enabled| **enabled).count())
                    .sum::<usize>()
            })
            .unwrap_or(0);
        let generator_routes = current
            .generator_bus_matrix
            .iter()
            .map(|row| {
                row.iter()
                    .skip(candidate.tx_channels)
                    .filter(|gain| gain.is_finite())
                    .count()
            })
            .sum::<usize>();
        let removed_links = current
            .output_stereo_links
            .iter()
            .filter(|link| {
                link.left_channel >= candidate.tx_channels
                    || link.right_channel >= candidate.tx_channels
            })
            .count();
        let mut details = vec![format!(
            "TX channels shrink from {} to {}.",
            current.tx_channels, candidate.tx_channels
        )];
        if direct_routes > 0 {
            details.push(format!(
                "{direct_routes} direct route(s) currently feed outputs that would be removed."
            ));
        }
        if bus_routes > 0 {
            details.push(format!(
                "{bus_routes} bus-to-output route(s) currently feed outputs that would be removed."
            ));
        }
        if generator_routes > 0 {
            details.push(format!(
                "{generator_routes} generator route(s) currently feed outputs that would be removed."
            ));
        }
        if removed_links > 0 {
            details.push(format!(
                "{removed_links} stereo output link(s) reference channels outside the new TX range."
            ));
        }
        warnings.push(ConfigCompatibilityWarning {
            code: "tx_shrink".to_string(),
            summary: "Output-count shrink can drop routed destinations and stereo output pairs."
                .to_string(),
            details,
        });
    }

    let current_bus_ids: BTreeSet<&str> = current
        .internal_buses
        .iter()
        .map(|bus| bus.id.as_str())
        .collect();
    let candidate_bus_ids: BTreeSet<&str> = candidate
        .internal_buses
        .iter()
        .map(|bus| bus.id.as_str())
        .collect();
    let removed_bus_indices = current
        .internal_buses
        .iter()
        .enumerate()
        .filter(|(_, bus)| !candidate_bus_ids.contains(bus.id.as_str()))
        .collect::<Vec<_>>();
    if !removed_bus_indices.is_empty() {
        let removed_bus_names = removed_bus_indices
            .iter()
            .map(|(_, bus)| bus.name.clone())
            .collect::<Vec<_>>();
        let input_feeds = removed_bus_indices
            .iter()
            .map(|(_, bus)| bus.routing.iter().filter(|enabled| **enabled).count())
            .sum::<usize>();
        let output_routes = current
            .bus_matrix
            .as_ref()
            .map(|matrix| {
                removed_bus_indices
                    .iter()
                    .map(|(index, _)| {
                        matrix
                            .iter()
                            .filter(|row| row.get(*index).copied().unwrap_or(false))
                            .count()
                    })
                    .sum::<usize>()
            })
            .unwrap_or(0);
        let feed_links = current
            .bus_feed_matrix
            .as_ref()
            .map(|matrix| {
                removed_bus_indices
                    .iter()
                    .map(|(index, _)| {
                        matrix
                            .get(*index)
                            .map(|row| row.iter().filter(|enabled| **enabled).count())
                            .unwrap_or(0)
                            + matrix
                                .iter()
                                .filter(|row| row.get(*index).copied().unwrap_or(false))
                                .count()
                    })
                    .sum::<usize>()
            })
            .unwrap_or(0);
        let mut details = vec![format!("Removed buses: {}.", removed_bus_names.join(", "))];
        if input_feeds > 0 {
            details.push(format!(
                "{input_feeds} input feed(s) currently terminate on those buses."
            ));
        }
        if output_routes > 0 {
            details.push(format!(
                "{output_routes} bus-to-output route(s) currently depend on those buses."
            ));
        }
        if feed_links > 0 {
            details.push(format!(
                "{feed_links} bus-to-bus feed link(s) currently reference those buses."
            ));
        }
        warnings.push(ConfigCompatibilityWarning {
            code: "bus_removal".to_string(),
            summary:
                "Removing internal buses can strand input feeds and downstream bus/output routes."
                    .to_string(),
            details,
        });
    } else if candidate.internal_buses.len() < current_bus_ids.len() {
        warnings.push(ConfigCompatibilityWarning {
            code: "bus_removal".to_string(),
            summary: "Bus count shrinks, but removed bus identities could not be matched cleanly."
                .to_string(),
            details: vec!["Review bus IDs and downstream routes before applying.".to_string()],
        });
    }

    let candidate_generator_ids: BTreeSet<&str> = candidate
        .signal_generators
        .iter()
        .map(|generator| generator.id.as_str())
        .collect();
    let removed_generators = current
        .signal_generators
        .iter()
        .enumerate()
        .filter(|(_, generator)| !candidate_generator_ids.contains(generator.id.as_str()))
        .collect::<Vec<_>>();
    if !removed_generators.is_empty() {
        let removed_names = removed_generators
            .iter()
            .map(|(_, generator)| generator.name.clone())
            .collect::<Vec<_>>();
        let routed_outputs = removed_generators
            .iter()
            .map(|(index, _)| {
                current
                    .generator_bus_matrix
                    .get(*index)
                    .map(|row| row.iter().filter(|gain| gain.is_finite()).count())
                    .unwrap_or(0)
            })
            .sum::<usize>();
        let mut details = vec![format!("Removed generators: {}.", removed_names.join(", "))];
        if routed_outputs > 0 {
            details.push(format!(
                "{routed_outputs} generator route(s) currently depend on those generators."
            ));
        }
        warnings.push(ConfigCompatibilityWarning {
            code: "generator_removal".to_string(),
            summary: "Removing built-in generators can break routed test-signal paths.".to_string(),
            details,
        });
    }

    warnings
}

#[derive(Default)]
struct ConfigDiffCollector {
    entries: Vec<ConfigDiffEntry>,
    top_level_fields: BTreeSet<String>,
    added: usize,
    removed: usize,
    changed: usize,
    total_changes: usize,
    truncated: bool,
}

struct CreateBackupRequest<'a> {
    source: BackupSource,
    requested_by: Option<&'a str>,
    note: Option<String>,
    target_config: Option<&'a PatchboxConfig>,
}

fn summarize_json_value(value: &serde_json::Value) -> String {
    let mut text = match value {
        serde_json::Value::String(s) => s.clone(),
        _ => serde_json::to_string(value).unwrap_or_else(|_| value.to_string()),
    };
    if text.len() > 120 {
        text.truncate(117);
        text.push_str("...");
    }
    text
}

fn diff_top_level_field(path: &str) -> String {
    path.split(['.', '['])
        .find(|part| !part.is_empty())
        .unwrap_or("<root>")
        .to_string()
}

fn record_config_diff(
    collector: &mut ConfigDiffCollector,
    path: String,
    kind: ConfigDiffKind,
    before: Option<&serde_json::Value>,
    after: Option<&serde_json::Value>,
) {
    collector.total_changes += 1;
    collector
        .top_level_fields
        .insert(diff_top_level_field(&path));
    match kind {
        ConfigDiffKind::Added => collector.added += 1,
        ConfigDiffKind::Removed => collector.removed += 1,
        ConfigDiffKind::Changed => collector.changed += 1,
    }
    if collector.entries.len() < MAX_CONFIG_DIFF_ENTRIES {
        collector.entries.push(ConfigDiffEntry {
            path,
            kind,
            before: before.map(summarize_json_value),
            after: after.map(summarize_json_value),
        });
    } else {
        collector.truncated = true;
    }
}

fn collect_config_diff(
    collector: &mut ConfigDiffCollector,
    path: String,
    current: &serde_json::Value,
    candidate: &serde_json::Value,
) {
    if current == candidate {
        return;
    }

    match (current, candidate) {
        (serde_json::Value::Object(current_obj), serde_json::Value::Object(candidate_obj)) => {
            let mut keys = BTreeSet::new();
            keys.extend(current_obj.keys().cloned());
            keys.extend(candidate_obj.keys().cloned());
            for key in keys {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                match (current_obj.get(&key), candidate_obj.get(&key)) {
                    (Some(before), Some(after)) => {
                        collect_config_diff(collector, child_path, before, after);
                    }
                    (Some(before), None) => {
                        record_config_diff(
                            collector,
                            child_path,
                            ConfigDiffKind::Removed,
                            Some(before),
                            None,
                        );
                    }
                    (None, Some(after)) => {
                        record_config_diff(
                            collector,
                            child_path,
                            ConfigDiffKind::Added,
                            None,
                            Some(after),
                        );
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
                        collect_config_diff(collector, child_path, before, after);
                    }
                    (Some(before), None) => {
                        record_config_diff(
                            collector,
                            child_path,
                            ConfigDiffKind::Removed,
                            Some(before),
                            None,
                        );
                    }
                    (None, Some(after)) => {
                        record_config_diff(
                            collector,
                            child_path,
                            ConfigDiffKind::Added,
                            None,
                            Some(after),
                        );
                    }
                    (None, None) => {}
                }
            }
        }
        _ => {
            let path = if path.is_empty() {
                "<root>".to_string()
            } else {
                path
            };
            record_config_diff(
                collector,
                path,
                ConfigDiffKind::Changed,
                Some(current),
                Some(candidate),
            );
        }
    }
}

fn build_config_diff_summary(
    current: &PatchboxConfig,
    candidate: &PatchboxConfig,
) -> (ConfigDiffSummary, Vec<ConfigDiffEntry>) {
    let current_json = serde_json::to_value(current).unwrap_or(serde_json::Value::Null);
    let candidate_json = serde_json::to_value(candidate).unwrap_or(serde_json::Value::Null);
    let mut collector = ConfigDiffCollector::default();
    collect_config_diff(
        &mut collector,
        String::new(),
        &current_json,
        &candidate_json,
    );

    let top_level_fields: Vec<_> = collector.top_level_fields.iter().cloned().collect();
    let description = if collector.total_changes == 0 {
        "No config changes.".to_string()
    } else {
        let preview = top_level_fields
            .iter()
            .take(4)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        let extra = top_level_fields.len().saturating_sub(4);
        if extra > 0 {
            format!(
                "{} change(s) across {} field group(s): {} (+{} more)",
                collector.total_changes,
                top_level_fields.len(),
                preview,
                extra
            )
        } else {
            format!(
                "{} change(s) across {} field group(s): {}",
                collector.total_changes,
                top_level_fields.len(),
                preview
            )
        }
    };

    (
        ConfigDiffSummary {
            description,
            total_changes: collector.total_changes,
            changed: collector.changed,
            added: collector.added,
            removed: collector.removed,
            top_level_fields,
            truncated: collector.truncated,
        },
        collector.entries,
    )
}

fn parse_config_candidate(toml_str: &str) -> Result<(PatchboxConfig, bool), String> {
    let mut cfg: PatchboxConfig = toml::from_str(toml_str).map_err(|e| e.to_string())?;
    let before_normalize = serde_json::to_value(&cfg).ok();
    cfg.normalize();
    let normalized = before_normalize
        .and_then(|before| serde_json::to_value(&cfg).ok().map(|after| before != after))
        .unwrap_or(false);
    Ok((cfg, normalized))
}

fn backup_metadata_path(path: &FsPath) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("backup.toml");
    path.with_file_name(format!("{file_name}.meta.json"))
}

fn timestamp_to_rfc3339(timestamp: u64) -> Option<String> {
    chrono::DateTime::from_timestamp(timestamp as i64, 0).map(|dt| dt.to_rfc3339())
}

fn read_backup_metadata(path: &FsPath, timestamp: u64) -> BackupMetadata {
    let metadata_path = backup_metadata_path(path);
    if let Ok(bytes) = std::fs::read(&metadata_path) {
        if let Ok(mut metadata) = serde_json::from_slice::<BackupMetadata>(&bytes) {
            metadata.has_metadata = true;
            if metadata.created_at.is_none() {
                metadata.created_at = timestamp_to_rfc3339(timestamp);
            }
            return metadata;
        }
    }

    BackupMetadata {
        has_metadata: false,
        created_at: timestamp_to_rfc3339(timestamp),
        source: BackupSource::Unknown,
        version: None,
        requested_by: None,
        note: None,
        summary: None,
    }
}

async fn sample_ptp_history_now(s: &AppState) -> PtpHistorySample {
    let cfg = s.config.read().await;
    let obs_path = cfg.statime_observation_path.clone();
    let clock_path = cfg.dante_clock_path.clone();
    drop(cfg);

    let offset_ns = if let Some(path) = obs_path.as_deref() {
        query_ptp_offset(path).await
    } else {
        None
    };
    let state = if let Some(path) = obs_path.as_deref() {
        query_ptp_state(path).await
    } else {
        None
    };

    let dante_connected = s.dante_connected.load(AOrdering::Relaxed);
    let ptp_synced = std::fs::metadata(&clock_path)
        .map(|m| m.file_type().is_socket())
        .unwrap_or(false);
    let locked = state
        .as_deref()
        .map(is_ptp_locked_state)
        .unwrap_or(dante_connected && ptp_synced);

    PtpHistorySample {
        ts_ms: chrono::Utc::now().timestamp_millis(),
        locked,
        offset_ns,
        state,
    }
}

async fn reload_runtime_config(s: &AppState) -> Result<(), String> {
    let text = std::fs::read_to_string(&s.config_path).map_err(|e| e.to_string())?;
    let mut new_cfg: PatchboxConfig = toml::from_str(&text).map_err(|e| e.to_string())?;
    new_cfg.normalize();
    new_cfg.validate().map_err(|e| e.to_string())?;

    {
        let old = s.config.read().await;
        new_cfg.rx_channels = old.rx_channels;
        new_cfg.tx_channels = old.tx_channels;
        new_cfg.dante_name = old.dante_name.clone();
        new_cfg.port = old.port;
    }

    *s.config.write().await = new_cfg;
    Ok(())
}

fn schedule_process_restart(state: &AppState) {
    if !state.exit_on_restart {
        return;
    }
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        std::process::exit(0);
    });
}

async fn log_dante_event(state: &AppState, level: &str, message: &str, details: Option<String>) {
    state
        .push_event_log(EventLogEntry::runtime(level, message, details))
        .await;
}

fn claims_actor(claims: Option<&Extension<crate::jwt::Claims>>) -> Option<EventActor> {
    claims.map(|Extension(claims)| EventActor::from_claims(claims))
}

async fn log_audit_event(
    state: &AppState,
    claims: Option<&Extension<crate::jwt::Claims>>,
    action: &str,
    message: impl Into<String>,
    details: Option<String>,
    resource: Option<EventResource>,
    context: Option<serde_json::Value>,
) {
    state
        .push_audit_log(
            action,
            message,
            details,
            claims_actor(claims),
            resource,
            context,
        )
        .await;
}

fn emit_task_event(
    state: &AppState,
    claims: Option<&Extension<crate::jwt::Claims>>,
    task_id: impl Into<String>,
    status: TaskStatus,
    label: impl Into<String>,
    message: Option<String>,
    action: Option<&str>,
    resource: Option<EventResource>,
    context: Option<serde_json::Value>,
) {
    state.emit_task_event(TaskEvent::new(
        task_id,
        status,
        label,
        message,
        action.map(str::to_string),
        claims_actor(claims),
        resource,
        context,
    ));
}

async fn _create_backup(s: &AppState, request: CreateBackupRequest<'_>) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let current_cfg = s.config.read().await.clone();
    let toml_str = toml::to_string_pretty(&current_cfg).map_err(|e| e.to_string())?;
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
    let summary = request.target_config.map(|target| {
        let mut current = current_cfg.clone();
        current.normalize();
        let mut candidate = target.clone();
        candidate.normalize();
        build_config_diff_summary(&current, &candidate)
            .0
            .description
    });
    let metadata = BackupMetadata {
        has_metadata: true,
        created_at: timestamp_to_rfc3339(ts),
        source: request.source,
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        requested_by: request.requested_by.map(|value| value.to_string()),
        note: request.note,
        summary,
    };
    let metadata_bytes = serde_json::to_vec_pretty(&metadata).map_err(|e| e.to_string())?;
    std::fs::write(backup_metadata_path(&bak_path), metadata_bytes).map_err(|e| e.to_string())?;
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
                let old_path = old.path();
                let _ = std::fs::remove_file(&old_path);
                let _ = std::fs::remove_file(backup_metadata_path(&old_path));
            }
        }
    }
    Ok(bak_path.to_string_lossy().into_owned())
}

fn escape_prometheus_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('"', "\\\"")
}

async fn build_health_response(s: &AppState) -> HealthResponse {
    let cfg = s.config.read().await;
    let meters = s.meters.read().await;

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

    let dsp_cpu_avg = s.dsp_metrics.cpu_percent_avg();
    let dsp = HealthDsp {
        status: s.dsp_metrics.status().as_str(),
        cpu_percent: s.dsp_metrics.cpu_percent_instant(),
        cpu_percent_avg: dsp_cpu_avg,
        xruns: s.dsp_metrics.xruns(),
    };

    let clients_connected = s.ws_tx.receiver_count();
    let dante_connected = s.dante_connected.load(AOrdering::Relaxed);
    let dante_rx_channels = cfg.rx_channels;
    let dante_tx_channels = cfg.tx_channels;

    let active_routes = cfg.matrix.iter().flatten().filter(|&&v| v).count();
    let rx_levels_rms_db = meters.rx_rms.iter().map(|&v| linear_to_db(v)).collect();
    let tx_levels_rms_db = meters.tx_rms.iter().map(|&v| linear_to_db(v)).collect();

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

    let is_ptp_locked =
        ptp_state.as_deref() == Some("SLAVE") || ptp_state.as_deref() == Some("MASTER");
    let cpu_load_ok = dsp_cpu_avg < 90.0;
    let storage_free_ok = storage_free_bytes > 50 * 1024 * 1024;

    let status = if !dante_connected || !config_loaded || !storage_free_ok {
        "unhealthy"
    } else if !is_ptp_locked || !cpu_load_ok {
        "degraded"
    } else {
        "healthy"
    };

    HealthResponse {
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
    }
}

fn build_metrics_response(health: &HealthResponse) -> MetricsResponse {
    MetricsResponse {
        status: health.status,
        version: health.version,
        uptime_secs: health.uptime_secs,
        clients_connected: health.clients_connected,
        dante: MetricsDante {
            connected: health.dante.connected,
            rx_channels: health.dante.rx_channels,
            tx_channels: health.dante.tx_channels,
        },
        ptp: MetricsPtp {
            synced: health.ptp.synced,
            offset_ns: health.ptp.offset_ns,
            state: health.ptp.state.clone(),
        },
        audio: MetricsAudio {
            active_routes: health.audio.active_routes,
            callbacks_total: health.audio.callbacks_total,
            resyncs: health.audio.resyncs,
        },
        dsp: MetricsDsp {
            status: health.dsp.status,
            cpu_percent: health.dsp.cpu_percent,
            cpu_percent_avg: health.dsp.cpu_percent_avg,
            xruns: health.dsp.xruns,
        },
        storage: MetricsStorage {
            free_bytes: health.storage.free_bytes,
            total_bytes: health.storage.total_bytes,
        },
    }
}

fn render_prometheus_metrics(metrics: &MetricsResponse) -> String {
    let mut body = String::new();

    body.push_str("# HELP patchbox_info Patchbox build and service status.\n");
    body.push_str("# TYPE patchbox_info gauge\n");
    body.push_str(&format!(
        "patchbox_info{{version=\"{}\",status=\"{}\"}} 1\n",
        escape_prometheus_label(metrics.version),
        escape_prometheus_label(metrics.status),
    ));

    body.push_str("# HELP patchbox_uptime_seconds Process uptime in seconds.\n");
    body.push_str("# TYPE patchbox_uptime_seconds gauge\n");
    body.push_str(&format!(
        "patchbox_uptime_seconds {}\n",
        metrics.uptime_secs
    ));

    body.push_str("# HELP patchbox_ws_clients_connected Active websocket clients.\n");
    body.push_str("# TYPE patchbox_ws_clients_connected gauge\n");
    body.push_str(&format!(
        "patchbox_ws_clients_connected {}\n",
        metrics.clients_connected
    ));

    body.push_str("# HELP patchbox_dante_connected Dante runtime connectivity state.\n");
    body.push_str("# TYPE patchbox_dante_connected gauge\n");
    body.push_str(&format!(
        "patchbox_dante_connected {}\n",
        u8::from(metrics.dante.connected)
    ));
    body.push_str("# TYPE patchbox_dante_rx_channels gauge\n");
    body.push_str(&format!(
        "patchbox_dante_rx_channels {}\n",
        metrics.dante.rx_channels
    ));
    body.push_str("# TYPE patchbox_dante_tx_channels gauge\n");
    body.push_str(&format!(
        "patchbox_dante_tx_channels {}\n",
        metrics.dante.tx_channels
    ));

    body.push_str("# HELP patchbox_ptp_synced PTP clock socket availability.\n");
    body.push_str("# TYPE patchbox_ptp_synced gauge\n");
    body.push_str(&format!(
        "patchbox_ptp_synced {}\n",
        u8::from(metrics.ptp.synced)
    ));
    if let Some(offset_ns) = metrics.ptp.offset_ns {
        body.push_str("# TYPE patchbox_ptp_offset_nanoseconds gauge\n");
        body.push_str(&format!("patchbox_ptp_offset_nanoseconds {}\n", offset_ns));
    }
    if let Some(state) = &metrics.ptp.state {
        body.push_str("# TYPE patchbox_ptp_state gauge\n");
        body.push_str(&format!(
            "patchbox_ptp_state{{state=\"{}\"}} 1\n",
            escape_prometheus_label(state)
        ));
    }

    body.push_str("# HELP patchbox_audio_active_routes Active route count.\n");
    body.push_str("# TYPE patchbox_audio_active_routes gauge\n");
    body.push_str(&format!(
        "patchbox_audio_active_routes {}\n",
        metrics.audio.active_routes
    ));
    body.push_str(
        "# HELP patchbox_audio_callbacks_total Total RT audio callbacks since startup.\n",
    );
    body.push_str("# TYPE patchbox_audio_callbacks_total counter\n");
    body.push_str(&format!(
        "patchbox_audio_callbacks_total {}\n",
        metrics.audio.callbacks_total
    ));
    body.push_str("# HELP patchbox_audio_resyncs_total Total resyncs since startup.\n");
    body.push_str("# TYPE patchbox_audio_resyncs_total counter\n");
    body.push_str(&format!(
        "patchbox_audio_resyncs_total {}\n",
        metrics.audio.resyncs
    ));

    body.push_str("# HELP patchbox_dsp_status DSP subsystem status.\n");
    body.push_str("# TYPE patchbox_dsp_status gauge\n");
    body.push_str(&format!(
        "patchbox_dsp_status{{status=\"{}\"}} 1\n",
        escape_prometheus_label(metrics.dsp.status)
    ));
    body.push_str("# TYPE patchbox_dsp_cpu_percent gauge\n");
    body.push_str(&format!(
        "patchbox_dsp_cpu_percent {}\n",
        metrics.dsp.cpu_percent
    ));
    body.push_str("# TYPE patchbox_dsp_cpu_percent_avg gauge\n");
    body.push_str(&format!(
        "patchbox_dsp_cpu_percent_avg {}\n",
        metrics.dsp.cpu_percent_avg
    ));
    body.push_str("# TYPE patchbox_dsp_xruns_total counter\n");
    body.push_str(&format!("patchbox_dsp_xruns_total {}\n", metrics.dsp.xruns));

    body.push_str("# TYPE patchbox_storage_free_bytes gauge\n");
    body.push_str(&format!(
        "patchbox_storage_free_bytes {}\n",
        metrics.storage.free_bytes
    ));
    body.push_str("# TYPE patchbox_storage_total_bytes gauge\n");
    body.push_str(&format!(
        "patchbox_storage_total_bytes {}\n",
        metrics.storage.total_bytes
    ));

    body
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
    Json(build_health_response(&s).await)
}

// GET /api/v1/metrics
pub async fn get_metrics(State(s): State<AppState>) -> impl IntoResponse {
    let health = build_health_response(&s).await;
    Json(build_metrics_response(&health))
}

// GET /api/v1/metrics/prometheus
pub async fn get_metrics_prometheus(State(s): State<AppState>) -> impl IntoResponse {
    let health = build_health_response(&s).await;
    let metrics = build_metrics_response(&health);
    (
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        render_prometheus_metrics(&metrics),
    )
        .into_response()
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

// GET /api/v1/system/dante/diagnostics
#[utoipa::path(
    get,
    path = "/api/v1/system/dante/diagnostics",
    tag = "system",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Dante diagnostics", body = DanteDiagnosticsResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_dante_diagnostics(State(s): State<AppState>) -> impl IntoResponse {
    let cfg = s.config.read().await;
    let dante_name = cfg.dante_name.clone();
    let dante_nic = cfg.dante_nic.clone();
    let rx_channels = cfg.rx_channels;
    let tx_channels = cfg.tx_channels;
    let clock_path = cfg.dante_clock_path.clone();
    let obs_path = cfg.statime_observation_path.clone();

    let dante_connected = s.dante_connected.load(AOrdering::Relaxed);

    let device = DiagnosticCard {
        level: if dante_connected {
            DiagnosticLevel::Ok
        } else {
            DiagnosticLevel::Warn
        },
        summary: if dante_connected {
            "Dante connected".to_string()
        } else {
            "Dante disconnected".to_string()
        },
        items: vec![
            DiagnosticItem {
                label: "Device".to_string(),
                value: dante_name,
            },
            DiagnosticItem {
                label: "NIC".to_string(),
                value: dante_nic.clone(),
            },
            DiagnosticItem {
                label: "RX".to_string(),
                value: rx_channels.to_string(),
            },
            DiagnosticItem {
                label: "TX".to_string(),
                value: tx_channels.to_string(),
            },
        ],
    };

    let network = DiagnosticCard {
        level: DiagnosticLevel::Unknown,
        summary: "Network".to_string(),
        items: vec![DiagnosticItem {
            label: "NIC".to_string(),
            value: dante_nic,
        }],
    };

    let ptp_synced = std::fs::metadata(&clock_path)
        .map(|m| m.file_type().is_socket())
        .unwrap_or(false);

    let ptp_offset_ns = if let Some(path) = obs_path.as_deref() {
        query_ptp_offset(path).await
    } else {
        None
    };
    let ptp_state = if let Some(path) = obs_path.as_deref() {
        query_ptp_state(path).await
    } else {
        None
    };

    let ptp_locked = ptp_state
        .as_deref()
        .map(is_ptp_locked_state)
        .unwrap_or(dante_connected && ptp_synced);

    let ptp_level = if ptp_locked {
        DiagnosticLevel::Ok
    } else if dante_connected {
        DiagnosticLevel::Warn
    } else {
        DiagnosticLevel::Unknown
    };

    let ptp_summary = if ptp_locked {
        "PTP locked".to_string()
    } else {
        "PTP not locked".to_string()
    };

    let mut ptp_items = vec![
        DiagnosticItem {
            label: "Clock socket".to_string(),
            value: if ptp_synced {
                format!("{} (present)", clock_path)
            } else {
                format!("{} (missing)", clock_path)
            },
        },
        DiagnosticItem {
            label: "Observation socket".to_string(),
            value: obs_path
                .clone()
                .unwrap_or_else(|| "(not configured)".to_string()),
        },
    ];

    if let Some(state) = &ptp_state {
        ptp_items.push(DiagnosticItem {
            label: "State".to_string(),
            value: state.clone(),
        });
    }
    if let Some(offset) = ptp_offset_ns {
        ptp_items.push(DiagnosticItem {
            label: "Offset".to_string(),
            value: format!("{offset} ns"),
        });
    }

    let ptp = DiagnosticCard {
        level: ptp_level,
        summary: ptp_summary,
        items: ptp_items,
    };

    let ptp_history = s.ptp_history.read().await.iter().cloned().collect();
    let meters = s.meters.read().await;
    let roster = build_dante_endpoint_roster(&cfg, &meters);
    let subscriptions = build_dante_subscription_statuses(&cfg, &meters);
    drop(meters);
    drop(cfg);

    Json(DanteDiagnosticsResponse {
        event_log: s.event_log.read().await.iter().cloned().collect(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        device,
        network,
        ptp,
        ptp_history,
        roster,
        subscriptions,
        recovery_actions: dante_recovery_actions(),
    })
}

// POST /api/v1/system/dante/recovery-actions/:action
#[utoipa::path(
    post,
    path = "/api/v1/system/dante/recovery-actions/{action}",
    tag = "system",
    security(("bearer_auth" = [])),
    params(
        ("action" = String, Path, description = "Recovery action id: rescan, rebind, restart")
    ),
    responses(
        (status = 200, description = "Recovery action accepted", body = DanteRecoveryActionResponse),
        (status = 400, description = "Unsupported action", body = crate::api::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 500, description = "Action failed", body = crate::api::ErrorResponse)
    )
)]
pub async fn post_dante_recovery_action(
    State(state): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Path(action): Path<String>,
) -> impl IntoResponse {
    let task_id = format!("recovery:{action}");
    let action_label = match action.as_str() {
        "rescan" => "Running recovery rescan",
        "rebind" => "Reloading runtime config",
        "restart" => "Restarting Minos",
        _ => "Running recovery action",
    };
    emit_task_event(
        &state,
        claims.as_ref(),
        task_id.clone(),
        TaskStatus::Started,
        action_label,
        None,
        Some("system.recovery"),
        Some(EventResource::new(
            "recovery_action",
            Some(action.clone()),
            Some(action.clone()),
        )),
        None,
    );
    match action.as_str() {
        "rescan" => {
            let sample = sample_ptp_history_now(&state).await;
            state.push_ptp_history(sample).await;
            log_dante_event(
                &state,
                "info",
                "Recovery action: rescan",
                Some("Captured fresh Dante/PTP sample".to_string()),
            )
            .await;
            log_audit_event(
                &state,
                claims.as_ref(),
                "system.recovery",
                "Executed recovery rescan.",
                None,
                Some(EventResource::new(
                    "recovery_action",
                    Some(action.clone()),
                    Some(action.clone()),
                )),
                Some(serde_json::json!({ "action": action })),
            )
            .await;
            emit_task_event(
                &state,
                claims.as_ref(),
                task_id,
                TaskStatus::Succeeded,
                action_label,
                Some("Captured fresh Dante/PTP sample.".to_string()),
                Some("system.recovery"),
                Some(EventResource::new(
                    "recovery_action",
                    Some(action.clone()),
                    Some(action.clone()),
                )),
                None,
            );
            Json(DanteRecoveryActionResponse {
                ok: true,
                action: DanteRecoveryActionId::Rescan,
                message: "Captured fresh Dante/PTP sample.".to_string(),
                restarting: false,
            })
            .into_response()
        }
        "rebind" => match reload_runtime_config(&state).await {
            Ok(()) => {
                log_dante_event(
                    &state,
                    "info",
                    "Recovery action: rebind",
                    Some("Runtime config reloaded from disk".to_string()),
                )
                .await;
                log_audit_event(
                    &state,
                    claims.as_ref(),
                    "system.recovery",
                    "Reloaded runtime config from disk.",
                    None,
                    Some(EventResource::new(
                        "recovery_action",
                        Some(action.clone()),
                        Some(action.clone()),
                    )),
                    Some(serde_json::json!({ "action": action })),
                )
                .await;
                emit_task_event(
                    &state,
                    claims.as_ref(),
                    task_id,
                    TaskStatus::Succeeded,
                    action_label,
                    Some("Runtime config reloaded from disk.".to_string()),
                    Some("system.recovery"),
                    Some(EventResource::new(
                        "recovery_action",
                        Some(action.clone()),
                        Some(action.clone()),
                    )),
                    None,
                );
                Json(DanteRecoveryActionResponse {
                    ok: true,
                    action: DanteRecoveryActionId::Rebind,
                    message: "Runtime config reloaded from disk.".to_string(),
                    restarting: false,
                })
                .into_response()
            }
            Err(error) => {
                log_dante_event(
                    &state,
                    "error",
                    "Recovery action failed: rebind",
                    Some(error.clone()),
                )
                .await;
                emit_task_event(
                    &state,
                    claims.as_ref(),
                    task_id,
                    TaskStatus::Failed,
                    action_label,
                    Some(error.clone()),
                    Some("system.recovery"),
                    Some(EventResource::new(
                        "recovery_action",
                        Some(action.clone()),
                        Some(action.clone()),
                    )),
                    None,
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(crate::api::ErrorResponse {
                        error,
                        in_memory: None,
                    }),
                )
                    .into_response()
            }
        },
        "restart" => {
            let _ = state.persist().await;
            log_dante_event(
                &state,
                "warn",
                "Recovery action: restart",
                Some("Restart requested from Dante diagnostics".to_string()),
            )
            .await;
            log_audit_event(
                &state,
                claims.as_ref(),
                "system.recovery",
                "Requested Minos restart from diagnostics.",
                None,
                Some(EventResource::new(
                    "recovery_action",
                    Some(action.clone()),
                    Some(action.clone()),
                )),
                Some(serde_json::json!({ "action": action })),
            )
            .await;
            emit_task_event(
                &state,
                claims.as_ref(),
                task_id,
                TaskStatus::Succeeded,
                action_label,
                Some("Restarting Minos.".to_string()),
                Some("system.recovery"),
                Some(EventResource::new(
                    "recovery_action",
                    Some(action.clone()),
                    Some(action.clone()),
                )),
                Some(serde_json::json!({ "restarting": true })),
            );
            schedule_process_restart(&state);
            Json(DanteRecoveryActionResponse {
                ok: true,
                action: DanteRecoveryActionId::Restart,
                message: "Restarting Minos.".to_string(),
                restarting: true,
            })
            .into_response()
        }
        _ => {
            log_dante_event(
                &state,
                "warn",
                "Unsupported recovery action",
                Some(action.clone()),
            )
            .await;
            emit_task_event(
                &state,
                claims.as_ref(),
                task_id,
                TaskStatus::Failed,
                action_label,
                Some(format!("unsupported recovery action: {action}")),
                Some("system.recovery"),
                Some(EventResource::new(
                    "recovery_action",
                    Some(action.clone()),
                    Some(action.clone()),
                )),
                None,
            );
            (
                StatusCode::BAD_REQUEST,
                Json(crate::api::ErrorResponse {
                    error: format!("unsupported recovery action: {action}"),
                    in_memory: None,
                }),
            )
                .into_response()
        }
    }
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
    let statime_obs_path = cfg.statime_observation_path.clone();
    drop(cfg);
    let dante_connected = s.dante_connected.load(AOrdering::Relaxed);
    let (ptp_state, ptp_offset_ns) = if let Some(ref obs_path) = statime_obs_path {
        tokio::join!(
            query_ptp_state(obs_path),
            query_ptp_offset(obs_path)
        )
    } else {
        (None, None)
    };
    let ptp_locked = ptp_state.as_ref().map(|s| is_ptp_locked_state(s)).unwrap_or(false);
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
        ptp_state,
        ptp_offset_ns,
        audio_drops: s.resyncs.load(AOrdering::Relaxed),
        bus_count,
        show_buses_in_mixer,
        monitor_device,
        monitor_volume_db,
    })
}

// GET /api/v1/system/audit
#[utoipa::path(
    get,
    path = "/api/v1/system/audit",
    tag = "system",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Audit entries", body = AuditLogResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn get_audit_log(State(s): State<AppState>) -> impl IntoResponse {
    let entries: Vec<EventLogEntry> = s
        .event_log
        .read()
        .await
        .iter()
        .filter(|entry| entry.category == "audit")
        .cloned()
        .collect();
    Json(AuditLogResponse {
        total: entries.len(),
        entries,
    })
}

// GET /api/v1/system/audit/export
#[utoipa::path(
    get,
    path = "/api/v1/system/audit/export",
    tag = "system",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Audit export download", body = AuditExportResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse)
    )
)]
pub async fn export_audit_log(State(s): State<AppState>) -> impl IntoResponse {
    let entries: Vec<EventLogEntry> = s
        .event_log
        .read()
        .await
        .iter()
        .filter(|entry| entry.category == "audit")
        .cloned()
        .collect();
    let payload = AuditExportResponse {
        exported_at: chrono::Utc::now().to_rfc3339(),
        total: entries.len(),
        entries,
    };
    let filename = format!(
        "patchbox-audit-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );
    (
        [
            (header::CONTENT_TYPE, "application/json".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        Json(payload),
    )
        .into_response()
}

// POST /api/v1/bulk
#[utoipa::path(
    post,
    path = "/api/v1/bulk",
    tag = "system",
    security(("bearer_auth" = [])),
    request_body = BulkMutationRequest,
    responses(
        (status = 200, description = "Bulk mutation applied", body = BulkMutationResponse),
        (status = 400, description = "Invalid bulk mutation", body = crate::api::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 404, description = "Target not found", body = crate::api::ErrorResponse)
    )
)]
pub async fn post_bulk_mutation(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(body): Json<BulkMutationRequest>,
) -> impl IntoResponse {
    match body {
        BulkMutationRequest::SetAllOutputsMuted { muted } => {
            if let Err(response) = auth_api::ensure_not_zone_scoped(
                claims.as_ref(),
                "Zone-scoped users cannot change all outputs at once.",
            ) {
                return response;
            }
            let operation = if muted {
                "set_all_outputs_muted"
            } else {
                "clear_all_output_mutes"
            };
            let task_id = format!("bulk:{operation}");
            let label = if muted {
                "Muting all outputs"
            } else {
                "Unmuting all outputs"
            };
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Started,
                label,
                None,
                Some("bulk.outputs_mute"),
                Some(EventResource::new(
                    "output",
                    None,
                    Some("All outputs".to_string()),
                )),
                Some(serde_json::json!({ "muted": muted })),
            );

            let affected = {
                let mut cfg = s.config.write().await;
                let mut changed = 0usize;
                for tx in 0..cfg.tx_channels {
                    if set_output_muted_state(&mut cfg, tx, muted) {
                        changed += 1;
                    }
                }
                changed
            };
            crate::persist_or_500!(s);
            log_audit_event(
                &s,
                claims.as_ref(),
                "bulk.outputs_mute",
                if muted {
                    "Muted all outputs."
                } else {
                    "Cleared all output mutes."
                },
                None,
                Some(EventResource::new(
                    "output",
                    None,
                    Some("All outputs".to_string()),
                )),
                Some(serde_json::json!({ "muted": muted, "affected": affected })),
            )
            .await;
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Succeeded,
                label,
                Some(format!("Updated {affected} outputs.")),
                Some("bulk.outputs_mute"),
                Some(EventResource::new(
                    "output",
                    None,
                    Some("All outputs".to_string()),
                )),
                Some(serde_json::json!({ "muted": muted, "affected": affected })),
            );
            Json(BulkMutationResponse {
                ok: true,
                operation: operation.to_string(),
                affected,
                task_id,
            })
            .into_response()
        }
        BulkMutationRequest::SetZoneOutputsMuted { zone_id, muted } => {
            if let Err(response) = auth_api::ensure_zone_scope_target(
                claims.as_ref(),
                &zone_id,
                "Zone-scoped users can only change outputs in their own zone.",
            ) {
                return response;
            }
            if parse_zone_id(&zone_id).is_none() {
                emit_task_event(
                    &s,
                    claims.as_ref(),
                    format!("bulk:set_zone_outputs_muted:{zone_id}"),
                    TaskStatus::Failed,
                    "Updating zone output mutes",
                    Some("Invalid zone id.".to_string()),
                    Some("bulk.zone_outputs_mute"),
                    Some(EventResource::new(
                        "zone",
                        Some(zone_id.clone()),
                        Some(zone_id.clone()),
                    )),
                    Some(serde_json::json!({ "muted": muted })),
                );
                return (
                    StatusCode::BAD_REQUEST,
                    Json(crate::api::ErrorResponse {
                        error: "invalid zone id (expected zone_N)".to_string(),
                        in_memory: None,
                    }),
                )
                    .into_response();
            }

            let task_id = format!("bulk:set_zone_outputs_muted:{zone_id}");
            let label = if muted {
                "Muting zone outputs"
            } else {
                "Unmuting zone outputs"
            };
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Started,
                label,
                None,
                Some("bulk.zone_outputs_mute"),
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_id.clone()),
                )),
                Some(serde_json::json!({ "muted": muted })),
            );

            let (zone_name, affected) = {
                let mut cfg = s.config.write().await;
                let Some(zone) = cfg
                    .zone_config
                    .iter()
                    .find(|zone| zone.id == zone_id)
                    .cloned()
                else {
                    emit_task_event(
                        &s,
                        claims.as_ref(),
                        task_id.clone(),
                        TaskStatus::Failed,
                        label,
                        Some("Zone not found.".to_string()),
                        Some("bulk.zone_outputs_mute"),
                        Some(EventResource::new(
                            "zone",
                            Some(zone_id.clone()),
                            Some(zone_id.clone()),
                        )),
                        Some(serde_json::json!({ "muted": muted })),
                    );
                    return (
                        StatusCode::NOT_FOUND,
                        Json(crate::api::ErrorResponse {
                            error: "zone not found".to_string(),
                            in_memory: None,
                        }),
                    )
                        .into_response();
                };

                let mut changed = 0usize;
                for tx_id in &zone.tx_ids {
                    let Some(tx) = parse_tx_id(tx_id) else {
                        continue;
                    };
                    if tx >= cfg.tx_channels {
                        continue;
                    }
                    if set_output_muted_state(&mut cfg, tx, muted) {
                        changed += 1;
                    }
                }

                (zone.name, changed)
            };
            crate::persist_or_500!(s);
            log_audit_event(
                &s,
                claims.as_ref(),
                "bulk.zone_outputs_mute",
                if muted {
                    format!("Muted outputs for zone {zone_id}.")
                } else {
                    format!("Cleared output mutes for zone {zone_id}.")
                },
                None,
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_name.clone()),
                )),
                Some(serde_json::json!({ "muted": muted, "affected": affected })),
            )
            .await;
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Succeeded,
                label,
                Some(format!("Updated {affected} outputs.")),
                Some("bulk.zone_outputs_mute"),
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_name),
                )),
                Some(serde_json::json!({ "muted": muted, "affected": affected })),
            );
            Json(BulkMutationResponse {
                ok: true,
                operation: "set_zone_outputs_muted".to_string(),
                affected,
                task_id,
            })
            .into_response()
        }
        BulkMutationRequest::ApplyZoneTemplate {
            zone_id,
            template_id,
        } => {
            if let Err(response) = auth_api::ensure_zone_scope_target(
                claims.as_ref(),
                &zone_id,
                "Zone-scoped users can only apply templates to their own zone.",
            ) {
                return response;
            }
            if parse_zone_id(&zone_id).is_none() {
                emit_task_event(
                    &s,
                    claims.as_ref(),
                    format!("bulk:apply_zone_template:{zone_id}:{template_id}"),
                    TaskStatus::Failed,
                    "Applying zone template",
                    Some("Invalid zone id.".to_string()),
                    Some("bulk.apply_zone_template"),
                    Some(EventResource::new(
                        "zone",
                        Some(zone_id.clone()),
                        Some(zone_id.clone()),
                    )),
                    Some(serde_json::json!({ "template_id": template_id })),
                );
                return (
                    StatusCode::BAD_REQUEST,
                    Json(crate::api::ErrorResponse {
                        error: "invalid zone id (expected zone_N)".to_string(),
                        in_memory: None,
                    }),
                )
                    .into_response();
            }
            if parse_zone_template_id(&template_id).is_none() {
                emit_task_event(
                    &s,
                    claims.as_ref(),
                    format!("bulk:apply_zone_template:{zone_id}:{template_id}"),
                    TaskStatus::Failed,
                    "Applying zone template",
                    Some("Invalid zone template id.".to_string()),
                    Some("bulk.apply_zone_template"),
                    Some(EventResource::new(
                        "zone",
                        Some(zone_id.clone()),
                        Some(zone_id.clone()),
                    )),
                    Some(serde_json::json!({ "template_id": template_id })),
                );
                return (
                    StatusCode::BAD_REQUEST,
                    Json(crate::api::ErrorResponse {
                        error: "invalid zone template id (expected zone_template_N)".to_string(),
                        in_memory: None,
                    }),
                )
                    .into_response();
            }

            let task_id = format!("bulk:apply_zone_template:{zone_id}:{template_id}");
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Started,
                "Applying zone template",
                None,
                Some("bulk.apply_zone_template"),
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_id.clone()),
                )),
                Some(serde_json::json!({ "template_id": template_id })),
            );

            let (zone_name, template_name, affected) = {
                let mut cfg = s.config.write().await;
                let Some(template) = cfg
                    .zone_templates
                    .iter()
                    .find(|template| template.id == template_id)
                    .cloned()
                else {
                    emit_task_event(
                        &s,
                        claims.as_ref(),
                        task_id.clone(),
                        TaskStatus::Failed,
                        "Applying zone template",
                        Some("Zone template not found.".to_string()),
                        Some("bulk.apply_zone_template"),
                        Some(EventResource::new(
                            "zone",
                            Some(zone_id.clone()),
                            Some(zone_id.clone()),
                        )),
                        Some(serde_json::json!({ "template_id": template_id })),
                    );
                    return (
                        StatusCode::NOT_FOUND,
                        Json(crate::api::ErrorResponse {
                            error: "zone template not found".to_string(),
                            in_memory: None,
                        }),
                    )
                        .into_response();
                };

                let Some(zone_idx) = cfg.zone_config.iter().position(|zone| zone.id == zone_id)
                else {
                    emit_task_event(
                        &s,
                        claims.as_ref(),
                        task_id.clone(),
                        TaskStatus::Failed,
                        "Applying zone template",
                        Some("Zone not found.".to_string()),
                        Some("bulk.apply_zone_template"),
                        Some(EventResource::new(
                            "zone",
                            Some(zone_id.clone()),
                            Some(zone_id.clone()),
                        )),
                        Some(serde_json::json!({ "template_id": template_id })),
                    );
                    return (
                        StatusCode::NOT_FOUND,
                        Json(crate::api::ErrorResponse {
                            error: "zone not found".to_string(),
                            in_memory: None,
                        }),
                    )
                        .into_response();
                };

                let zone_name = cfg.zone_config[zone_idx].name.clone();
                let tx_ids = cfg.zone_config[zone_idx].tx_ids.clone();
                cfg.zone_config[zone_idx].colour_index = template.colour_index;

                let mut touched = 0usize;
                for tx_id in &tx_ids {
                    let Some(tx) = parse_tx_id(tx_id) else {
                        continue;
                    };
                    if tx >= cfg.tx_channels {
                        continue;
                    }
                    apply_zone_template_to_output(&mut cfg, tx, &template);
                    touched += 1;
                }

                (zone_name, template.name, touched)
            };
            crate::persist_or_500!(s);
            log_audit_event(
                &s,
                claims.as_ref(),
                "bulk.apply_zone_template",
                format!("Applied template {template_id} to zone {zone_id}."),
                None,
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_name.clone()),
                )),
                Some(serde_json::json!({
                    "template_id": template_id,
                    "template_name": template_name,
                    "affected": affected,
                })),
            )
            .await;
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Succeeded,
                "Applying zone template",
                Some(format!("Updated {affected} outputs.")),
                Some("bulk.apply_zone_template"),
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_name),
                )),
                Some(serde_json::json!({
                    "template_id": template_id,
                    "template_name": template_name,
                    "affected": affected,
                })),
            );
            Json(BulkMutationResponse {
                ok: true,
                operation: "apply_zone_template".to_string(),
                affected,
                task_id,
            })
            .into_response()
        }
        BulkMutationRequest::ClearZoneRoutes { zone_id } => {
            if let Err(response) = auth_api::ensure_zone_scope_target(
                claims.as_ref(),
                &zone_id,
                "Zone-scoped users can only clear routes in their own zone.",
            ) {
                return response;
            }
            if parse_zone_id(&zone_id).is_none() {
                emit_task_event(
                    &s,
                    claims.as_ref(),
                    format!("bulk:clear_zone_routes:{zone_id}"),
                    TaskStatus::Failed,
                    "Clearing zone routes",
                    Some("Invalid zone id.".to_string()),
                    Some("bulk.clear_zone_routes"),
                    Some(EventResource::new(
                        "zone",
                        Some(zone_id.clone()),
                        Some(zone_id.clone()),
                    )),
                    None,
                );
                return (
                    StatusCode::BAD_REQUEST,
                    Json(crate::api::ErrorResponse {
                        error: "invalid zone id (expected zone_N)".to_string(),
                        in_memory: None,
                    }),
                )
                    .into_response();
            }

            let task_id = format!("bulk:clear_zone_routes:{zone_id}");
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Started,
                "Clearing zone routes",
                None,
                Some("bulk.clear_zone_routes"),
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_id.clone()),
                )),
                None,
            );

            let affected = {
                let mut cfg = s.config.write().await;
                let Some(zone) = cfg.zone_config.iter().find(|zone| zone.id == zone_id) else {
                    emit_task_event(
                        &s,
                        claims.as_ref(),
                        task_id.clone(),
                        TaskStatus::Failed,
                        "Clearing zone routes",
                        Some("Zone not found.".to_string()),
                        Some("bulk.clear_zone_routes"),
                        Some(EventResource::new(
                            "zone",
                            Some(zone_id.clone()),
                            Some(zone_id.clone()),
                        )),
                        None,
                    );
                    return (
                        StatusCode::NOT_FOUND,
                        Json(crate::api::ErrorResponse {
                            error: "zone not found".to_string(),
                            in_memory: None,
                        }),
                    )
                        .into_response();
                };

                let tx_ids = zone.tx_ids.clone();
                let mut changed = 0usize;
                for tx_id in tx_ids {
                    let Some(tx) = parse_tx_id(&tx_id) else {
                        continue;
                    };
                    if let Some(row) = cfg.matrix.get_mut(tx) {
                        for cell in row {
                            if *cell {
                                *cell = false;
                                changed += 1;
                            }
                        }
                    }
                }
                changed
            };
            crate::persist_or_500!(s);
            log_audit_event(
                &s,
                claims.as_ref(),
                "bulk.clear_zone_routes",
                format!("Cleared routes for zone {zone_id}."),
                None,
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_id.clone()),
                )),
                Some(serde_json::json!({ "affected": affected })),
            )
            .await;
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id.clone(),
                TaskStatus::Succeeded,
                "Clearing zone routes",
                Some(format!("Cleared {affected} routes.")),
                Some("bulk.clear_zone_routes"),
                Some(EventResource::new(
                    "zone",
                    Some(zone_id.clone()),
                    Some(zone_id.clone()),
                )),
                Some(serde_json::json!({ "affected": affected })),
            );
            Json(BulkMutationResponse {
                ok: true,
                operation: "clear_zone_routes".to_string(),
                affected,
                task_id,
            })
            .into_response()
        }
    }
}

// PUT /api/v1/system/config
pub async fn put_system_config(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    Json(body): Json<UpdateSystemConfig>,
) -> impl IntoResponse {
    let context = serde_json::json!({
        "scene_crossfade_ms": body.scene_crossfade_ms,
        "gain_ramp_ms": body.gain_ramp_ms,
        "show_buses_in_mixer": body.show_buses_in_mixer,
    });
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
    log_audit_event(
        &s,
        claims.as_ref(),
        "system.config.update",
        "Updated system config settings.",
        None,
        Some(EventResource::new(
            "config",
            Some("system".to_string()),
            Some("Patchbox system config".to_string()),
        )),
        Some(context),
    )
    .await;
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
    claims: Option<Extension<crate::jwt::Claims>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let task_id = "config:import".to_string();
    let body_len = body.len();
    emit_task_event(
        &s,
        claims.as_ref(),
        task_id.clone(),
        TaskStatus::Started,
        "Importing system config",
        None,
        Some("system.config.import"),
        Some(EventResource::new(
            "config",
            Some("system".to_string()),
            Some("Patchbox config".to_string()),
        )),
        Some(serde_json::json!({ "bytes": body_len })),
    );
    let toml_str = match std::str::from_utf8(&body) {
        Ok(s) => s,
        Err(_) => {
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id,
                TaskStatus::Failed,
                "Importing system config",
                Some("Body is not valid UTF-8.".to_string()),
                Some("system.config.import"),
                Some(EventResource::new(
                    "config",
                    Some("system".to_string()),
                    Some("Patchbox config".to_string()),
                )),
                Some(serde_json::json!({ "bytes": body_len })),
            );
            return (StatusCode::BAD_REQUEST, "body is not valid UTF-8").into_response();
        }
    };
    let (new_cfg, _) = match parse_config_candidate(toml_str) {
        Ok(cfg) => cfg,
        Err(e) => {
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id,
                TaskStatus::Failed,
                "Importing system config",
                Some(e.clone()),
                Some("system.config.import"),
                Some(EventResource::new(
                    "config",
                    Some("system".to_string()),
                    Some("Patchbox config".to_string()),
                )),
                Some(serde_json::json!({ "bytes": body_len })),
            );
            return (StatusCode::BAD_REQUEST, e).into_response();
        }
    };
    let requested_by = claims.as_ref().map(|Extension(claims)| claims.sub.as_str());
    let _ = _create_backup(
        &s,
        CreateBackupRequest {
            source: BackupSource::Import,
            requested_by,
            note: Some("Created before config import.".to_string()),
            target_config: Some(&new_cfg),
        },
    )
    .await;
    *s.config.write().await = new_cfg;
    crate::persist_or_500!(s);
    emit_task_event(
        &s,
        claims.as_ref(),
        task_id.clone(),
        TaskStatus::Succeeded,
        "Importing system config",
        Some("Imported system config.".to_string()),
        Some("system.config.import"),
        Some(EventResource::new(
            "config",
            Some("system".to_string()),
            Some("Patchbox config".to_string()),
        )),
        Some(serde_json::json!({ "bytes": body_len })),
    );
    log_audit_event(
        &s,
        claims.as_ref(),
        "system.config.import",
        "Imported system config.",
        None,
        Some(EventResource::new(
            "config",
            Some("system".to_string()),
            Some("Patchbox config".to_string()),
        )),
        Some(serde_json::json!({
            "source": "import",
            "bytes": body.len(),
        })),
    )
    .await;
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
    let mut baks: Vec<BackupListEntry> = std::fs::read_dir(dir)
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
            BackupListEntry {
                name,
                timestamp: ts,
                metadata: read_backup_metadata(&e.path(), ts),
            }
        })
        .collect();
    baks.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
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
    claims: Option<Extension<crate::jwt::Claims>>,
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
    let (new_cfg, _) = match parse_config_candidate(&toml_str) {
        Ok(cfg) => cfg,
        Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
    };
    let requested_by = claims.as_ref().map(|Extension(claims)| claims.sub.as_str());
    let _ = _create_backup(
        &s,
        CreateBackupRequest {
            source: BackupSource::BackupRestore,
            requested_by,
            note: Some(format!("Created before restoring backup {name}.")),
            target_config: Some(&new_cfg),
        },
    )
    .await;
    *s.config.write().await = new_cfg;
    crate::persist_or_500!(s);
    log_audit_event(
        &s,
        claims.as_ref(),
        "system.config.restore_backup",
        format!("Restored config backup {name}."),
        None,
        Some(EventResource::new(
            "config_backup",
            Some(name.clone()),
            Some(name.clone()),
        )),
        Some(serde_json::json!({
            "source": "backup_restore",
            "backup_name": name,
        })),
    )
    .await;
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

/// Response body for a successful config restore.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct RestoreResponse {
    pub status: String,
    pub message: String,
}

// POST /api/v1/system/config/validate
#[utoipa::path(
    post,
    path = "/api/v1/system/config/validate",
    tag = "system",
    security(("bearer_auth" = [])),
    request_body(content = String, content_type = "application/toml",
                 description = "Raw TOML configuration file to validate"),
    responses(
        (status = 200, description = "Validation result", body = ConfigValidateResponse),
        (status = 400, description = "Request body is not valid UTF-8",
         body = crate::api::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
    )
)]
pub async fn post_config_validate(
    State(s): State<AppState>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let toml_str = match std::str::from_utf8(&body) {
        Ok(s) => s,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(crate::api::ErrorResponse {
                    error: "request body is not valid UTF-8".to_string(),
                    in_memory: None,
                }),
            )
                .into_response();
        }
    };

    let (candidate, normalized) = match parse_config_candidate(toml_str) {
        Ok(result) => result,
        Err(error) => {
            return Json(ConfigValidateResponse {
                valid: false,
                normalized: false,
                errors: vec![format!("invalid config TOML: {error}")],
                warnings: vec![],
                summary: ConfigDiffSummary::default(),
                changes: vec![],
            })
            .into_response();
        }
    };

    let current = {
        let mut current = s.config.read().await.clone();
        current.normalize();
        current
    };
    let (summary, changes) = build_config_diff_summary(&current, &candidate);
    let warnings = build_config_validate_warnings(&current, &candidate);

    Json(ConfigValidateResponse {
        valid: true,
        normalized,
        errors: vec![],
        warnings,
        summary,
        changes,
    })
    .into_response()
}

// POST /api/v1/system/config/restore
#[utoipa::path(
    post,
    path = "/api/v1/system/config/restore",
    tag = "system",
    security(("bearer_auth" = [])),
    request_body(content = String, content_type = "application/toml",
                 description = "Raw TOML configuration file"),
    responses(
        (status = 200, description = "Config restored successfully", body = RestoreResponse),
        (status = 400, description = "Invalid TOML or config parse error",
         body = crate::api::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::api::ErrorResponse),
        (status = 500, description = "Persist error", body = crate::api::ErrorResponse),
    )
)]
pub async fn post_config_restore(
    State(s): State<AppState>,
    claims: Option<Extension<crate::jwt::Claims>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let task_id = "config:restore".to_string();
    let body_len = body.len();
    emit_task_event(
        &s,
        claims.as_ref(),
        task_id.clone(),
        TaskStatus::Started,
        "Restoring system config",
        None,
        Some("system.config.restore"),
        Some(EventResource::new(
            "config",
            Some("system".to_string()),
            Some("Patchbox config".to_string()),
        )),
        Some(serde_json::json!({ "bytes": body_len })),
    );
    let toml_str = match std::str::from_utf8(&body) {
        Ok(s) => s,
        Err(_) => {
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id,
                TaskStatus::Failed,
                "Restoring system config",
                Some("Request body is not valid UTF-8.".to_string()),
                Some("system.config.restore"),
                Some(EventResource::new(
                    "config",
                    Some("system".to_string()),
                    Some("Patchbox config".to_string()),
                )),
                Some(serde_json::json!({ "bytes": body_len })),
            );
            return (
                StatusCode::BAD_REQUEST,
                Json(crate::api::ErrorResponse {
                    error: "request body is not valid UTF-8".to_string(),
                    in_memory: None,
                }),
            )
                .into_response();
        }
    };
    let (new_cfg, _) = match parse_config_candidate(toml_str) {
        Ok(cfg) => cfg,
        Err(e) => {
            emit_task_event(
                &s,
                claims.as_ref(),
                task_id,
                TaskStatus::Failed,
                "Restoring system config",
                Some(format!("invalid config TOML: {e}")),
                Some("system.config.restore"),
                Some(EventResource::new(
                    "config",
                    Some("system".to_string()),
                    Some("Patchbox config".to_string()),
                )),
                Some(serde_json::json!({ "bytes": body_len })),
            );
            return (
                StatusCode::BAD_REQUEST,
                Json(crate::api::ErrorResponse {
                    error: format!("invalid config TOML: {e}"),
                    in_memory: None,
                }),
            )
                .into_response();
        }
    };
    let requested_by = claims.as_ref().map(|Extension(claims)| claims.sub.as_str());
    let _ = _create_backup(
        &s,
        CreateBackupRequest {
            source: BackupSource::Restore,
            requested_by,
            note: Some("Created before config restore.".to_string()),
            target_config: Some(&new_cfg),
        },
    )
    .await;
    *s.config.write().await = new_cfg;
    crate::persist_or_500!(s);
    emit_task_event(
        &s,
        claims.as_ref(),
        task_id.clone(),
        TaskStatus::Succeeded,
        "Restoring system config",
        Some("Config restored. Restart recommended.".to_string()),
        Some("system.config.restore"),
        Some(EventResource::new(
            "config",
            Some("system".to_string()),
            Some("Patchbox config".to_string()),
        )),
        Some(serde_json::json!({ "bytes": body_len })),
    );
    log_audit_event(
        &s,
        claims.as_ref(),
        "system.config.restore",
        "Restored system config from uploaded TOML.",
        None,
        Some(EventResource::new(
            "config",
            Some("system".to_string()),
            Some("Patchbox config".to_string()),
        )),
        Some(serde_json::json!({
            "source": "restore",
            "bytes": body.len(),
        })),
    )
    .await;
    Json(RestoreResponse {
        status: "ok".to_string(),
        message: "Config restored. Restart recommended.".to_string(),
    })
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
    schedule_process_restart(&state);
    (
        StatusCode::OK,
        Json(serde_json::json!({"ok": true, "restarting": true})),
    )
        .into_response()
}

// POST /api/v1/admin/restart
pub async fn post_admin_restart(State(state): State<AppState>) -> impl IntoResponse {
    let _ = state.persist().await;
    schedule_process_restart(&state);
    (
        StatusCode::OK,
        Json(serde_json::json!({"ok": true, "restarting": true})),
    )
        .into_response()
}
