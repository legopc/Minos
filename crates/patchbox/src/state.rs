use crate::ab_compare::AbCompareState;
use crate::jwt;
use crate::scenes::SceneStore;
use patchbox_core::config::PatchboxConfig;
pub use patchbox_core::meters::MeterState;
pub use patchbox_core::metrics::DspMetrics;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct PtpHistorySample {
    pub ts_ms: i64,
    pub locked: bool,
    pub offset_ns: Option<i64>,
    pub state: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct EventActor {
    pub username: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
}

impl EventActor {
    pub fn from_claims(claims: &jwt::Claims) -> Self {
        Self {
            username: claims.sub.clone(),
            role: claims.role.clone(),
            zone: claims.zone.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct EventResource {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl EventResource {
    pub fn new(kind: impl Into<String>, id: Option<String>, name: Option<String>) -> Self {
        Self {
            kind: kind.into(),
            id,
            name,
        }
    }
}

fn default_event_category() -> String {
    "runtime".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct EventLogEntry {
    pub ts_ms: i64,
    #[serde(default = "default_event_category")]
    pub category: String,
    pub level: String, // e.g. "info", "warn", "error"
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    pub details: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<EventActor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<EventResource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Object)]
    pub context: Option<serde_json::Value>,
}

impl EventLogEntry {
    pub fn runtime(
        level: impl Into<String>,
        message: impl Into<String>,
        details: Option<String>,
    ) -> Self {
        Self {
            ts_ms: chrono::Utc::now().timestamp_millis(),
            category: default_event_category(),
            level: level.into(),
            message: message.into(),
            action: None,
            details,
            actor: None,
            resource: None,
            context: None,
        }
    }

    pub fn audit(
        level: impl Into<String>,
        action: impl Into<String>,
        message: impl Into<String>,
        details: Option<String>,
        actor: Option<EventActor>,
        resource: Option<EventResource>,
        context: Option<serde_json::Value>,
    ) -> Self {
        Self {
            ts_ms: chrono::Utc::now().timestamp_millis(),
            category: "audit".to_string(),
            level: level.into(),
            message: message.into(),
            action: Some(action.into()),
            details,
            actor,
            resource,
            context,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Started,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TaskEvent {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub task_id: String,
    pub status: TaskStatus,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<EventActor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<EventResource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Object)]
    pub context: Option<serde_json::Value>,
}

impl TaskEvent {
    pub fn new(
        task_id: impl Into<String>,
        status: TaskStatus,
        label: impl Into<String>,
        message: Option<String>,
        action: Option<String>,
        actor: Option<EventActor>,
        resource: Option<EventResource>,
        context: Option<serde_json::Value>,
    ) -> Self {
        Self {
            event_type: "task",
            task_id: task_id.into(),
            status,
            label: label.into(),
            message,
            action,
            actor,
            resource,
            context,
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub event_log: Arc<RwLock<VecDeque<EventLogEntry>>>,
    pub config: Arc<RwLock<PatchboxConfig>>,
    pub config_path: PathBuf,
    pub meters: Arc<RwLock<MeterState>>,
    pub scenes: Arc<RwLock<SceneStore>>,
    pub scenes_path: PathBuf,
    /// JWT secret — regenerated on every server restart
    pub jwt_secret: Arc<RwLock<Vec<u8>>>,
    /// Set to true in main.rs after DanteDevice::start_with_state() succeeds
    pub dante_connected: Arc<AtomicBool>,
    /// In-memory PTP samples for the Dante diagnostics UI (bounded ring buffer)
    pub ptp_history: Arc<RwLock<VecDeque<PtpHistorySample>>>,
    /// Captured at startup for uptime_secs in /health
    pub started_at: std::time::Instant,
    /// Incremented by the RT audio callback on every block
    pub audio_callbacks: Arc<AtomicU64>,
    /// Incremented when the gap-resumption resync fires (block > 2×lead_samples)
    pub resyncs: Arc<AtomicU64>,
    /// Broadcast channel — WS handler subscribes; API mutation handlers send events
    pub ws_tx: Arc<broadcast::Sender<String>>,
    /// Ephemeral scene A/B compare state.
    pub ab_state: Arc<RwLock<AbCompareState>>,
    /// DSP engine CPU metrics — shared with health endpoint
    pub dsp_metrics: Arc<DspMetrics>,
    /// Shutdown signal for the ALSA monitor writer thread.
    /// (Reserved for future monitor thread restart API; not currently read from AppState)
    #[allow(dead_code)]
    pub monitor_shutdown: Arc<std::sync::atomic::AtomicBool>,
    /// Handle to monitor writer thread for restart.
    /// (Reserved for future monitor thread restart API; not currently read from AppState)
    #[allow(dead_code)]
    pub monitor_thread: Arc<std::sync::Mutex<Option<std::thread::JoinHandle<()>>>>,
    /// Debounced config persist task for high-frequency control changes.
    pub persist_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// Scene morph background task.
    pub morph_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// Disable process exit for restart-style API calls in tests.
    pub exit_on_restart: bool,
}

impl AppState {
    pub async fn push_event_log(&self, entry: EventLogEntry) {
        const MAX_EVENTS: usize = 200;
        let mut log = self.event_log.write().await;
        log.push_back(entry);
        while log.len() > MAX_EVENTS {
            log.pop_front();
        }
    }

    pub async fn push_audit_log(
        &self,
        action: impl Into<String>,
        message: impl Into<String>,
        details: Option<String>,
        actor: Option<EventActor>,
        resource: Option<EventResource>,
        context: Option<serde_json::Value>,
    ) {
        self.push_event_log(EventLogEntry::audit(
            "info", action, message, details, actor, resource, context,
        ))
        .await;
    }

    pub fn emit_task_event(&self, event: TaskEvent) {
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = self.ws_tx.send(json);
        }
    }

    pub fn new(config: PatchboxConfig, config_path: PathBuf) -> Self {
        let scenes_path = config_path.with_extension("scenes.toml");
        let scenes = SceneStore::load(&scenes_path);
        let meters = MeterState::new(config.rx_channels, config.tx_channels);
        let jwt_secret = jwt::load_or_generate_secret();
        let (ws_tx, _) = broadcast::channel(256);
        Self {
            event_log: Arc::new(RwLock::new(VecDeque::new())),
            config: Arc::new(RwLock::new(config)),
            config_path,
            meters: Arc::new(RwLock::new(meters)),
            scenes: Arc::new(RwLock::new(scenes)),
            scenes_path,
            jwt_secret: Arc::new(RwLock::new(jwt_secret)),
            dante_connected: Arc::new(AtomicBool::new(false)),
            ptp_history: Arc::new(RwLock::new(VecDeque::new())),
            started_at: std::time::Instant::now(),
            audio_callbacks: Arc::new(AtomicU64::new(0)),
            resyncs: Arc::new(AtomicU64::new(0)),
            ws_tx: Arc::new(ws_tx),
            ab_state: Arc::new(RwLock::new(AbCompareState::default())),
            dsp_metrics: Arc::new(DspMetrics::new()),
            monitor_shutdown: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            monitor_thread: Arc::new(std::sync::Mutex::new(None)),
            persist_task: Arc::new(Mutex::new(None)),
            morph_task: Arc::new(Mutex::new(None)),
            exit_on_restart: true,
        }
    }

    pub async fn persist(&self) -> Result<(), String> {
        use std::io::Write;
        let cfg = self.config.read().await;
        let s = toml::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
        drop(cfg);
        let tmp_path = self.config_path.with_extension("toml.tmp");
        {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp_path)
                .map_err(|e| e.to_string())?;
            f.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
        }
        std::fs::rename(&tmp_path, &self.config_path).map_err(|e| e.to_string())?;
        // fsync parent dir so the rename directory entry is durable
        if let Some(parent) = self.config_path.parent() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    }

    pub async fn persist_scenes(&self) -> Result<(), String> {
        let store = self.scenes.read().await;
        store.save(&self.scenes_path)
    }

    pub async fn schedule_persist(&self) {
        let mut task = self.persist_task.lock().await;
        if let Some(handle) = task.take() {
            handle.abort();
        }

        let state = self.clone();
        *task = Some(tokio::spawn(async move {
            sleep(Duration::from_millis(350)).await;
            if let Err(e) = state.persist().await {
                tracing::error!(error = %e, "debounced config persist failed");
            }
        }));
    }

    pub async fn push_ptp_history(&self, sample: PtpHistorySample) {
        const MAX_SAMPLES: usize = 120;
        let mut history = self.ptp_history.write().await;
        history.push_back(sample);
        while history.len() > MAX_SAMPLES {
            history.pop_front();
        }
    }
}
