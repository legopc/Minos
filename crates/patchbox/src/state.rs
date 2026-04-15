use patchbox_core::config::PatchboxConfig;
pub use patchbox_core::meters::MeterState;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64};
use tokio::sync::{RwLock, broadcast};
use crate::scenes::SceneStore;
use crate::jwt;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<RwLock<PatchboxConfig>>,
    pub config_path: PathBuf,
    pub meters: Arc<RwLock<MeterState>>,
    pub scenes: Arc<RwLock<SceneStore>>,
    pub scenes_path: PathBuf,
    /// JWT secret — regenerated on every server restart
    pub jwt_secret: Arc<RwLock<Vec<u8>>>,
    /// Set to true in main.rs after DanteDevice::start_with_state() succeeds
    pub dante_connected: Arc<AtomicBool>,
    /// Captured at startup for uptime_secs in /health
    pub started_at: std::time::Instant,
    /// Incremented by the RT audio callback on every block
    pub audio_callbacks: Arc<AtomicU64>,
    /// Incremented when the gap-resumption resync fires (block > 2×lead_samples)
    pub resyncs: Arc<AtomicU64>,
    /// Broadcast channel — WS handler subscribes; API mutation handlers send events
    pub ws_tx: Arc<broadcast::Sender<String>>,
    /// Shutdown signal for the ALSA monitor writer thread.
    pub monitor_shutdown: Arc<std::sync::atomic::AtomicBool>,
    /// Handle to monitor writer thread for restart.
    pub monitor_thread: Arc<std::sync::Mutex<Option<std::thread::JoinHandle<()>>>>,
}

impl AppState {
    pub fn new(config: PatchboxConfig, config_path: PathBuf) -> Self {
        let scenes_path = config_path.with_extension("scenes.toml");
        let scenes = SceneStore::load(&scenes_path);
        let meters = MeterState::new(config.rx_channels, config.tx_channels);
        let jwt_secret = jwt::load_or_generate_secret();
        let (ws_tx, _) = broadcast::channel(256);
        Self {
            config: Arc::new(RwLock::new(config)),
            config_path,
            meters: Arc::new(RwLock::new(meters)),
            scenes: Arc::new(RwLock::new(scenes)),
            scenes_path,
            jwt_secret: Arc::new(RwLock::new(jwt_secret)),
            dante_connected: Arc::new(AtomicBool::new(false)),
            started_at: std::time::Instant::now(),
            audio_callbacks: Arc::new(AtomicU64::new(0)),
            resyncs: Arc::new(AtomicU64::new(0)),
            ws_tx: Arc::new(ws_tx),
            monitor_shutdown: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            monitor_thread: Arc::new(std::sync::Mutex::new(None)),
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
                .write(true).create(true).truncate(true)
                .open(&tmp_path).map_err(|e| e.to_string())?;
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
}

