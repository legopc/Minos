use patchbox_core::control::{AudioParams, MeterFrame};
use patchbox_core::scene;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicUsize;
use std::time::Instant;
use tokio::sync::{Notify, RwLock};

use crate::config::Config;

pub struct AppState {
    pub config: Config,
    /// Audio parameters — shared between the REST API and the Dante audio bridge.
    pub params: Arc<RwLock<AudioParams>>,
    /// Live peak-metering data — written by the RT callback, read by the WS task.
    pub meters: Arc<RwLock<MeterFrame>>,
    /// Active WebSocket connection count — used for connection limit enforcement.
    pub ws_connections: Arc<AtomicUsize>,
    /// Process start time — used for uptime reporting in /health.
    pub started_at: Instant,
    /// Notified on graceful shutdown — Dante task listens to cancel cleanly (R-10).
    pub shutdown: Arc<Notify>,
}

impl AppState {
    pub fn new(cfg: Config) -> Self {
        Self {
            params:         Arc::new(RwLock::new(AudioParams::new(cfg.n_inputs, cfg.n_outputs))),
            meters:         Arc::new(RwLock::new(MeterFrame::new(cfg.n_inputs, cfg.n_outputs))),
            ws_connections: Arc::new(AtomicUsize::new(0)),
            started_at:     Instant::now(),
            shutdown:       Arc::new(Notify::new()),
            config:         cfg,
        }
    }

    pub fn scenes_dir(&self) -> PathBuf {
        PathBuf::from(&self.config.scenes_dir)
    }

    /// Persist the current params as a named scene.
    pub async fn save_scene(&self, name: &str) -> Result<(), scene::SceneError> {
        let params = self.params.read().await.clone();
        let s = scene::Scene { schema_version: 1, name: name.to_owned(), params };
        scene::save(&self.scenes_dir(), &s)
    }

    /// Load and apply a named scene.
    pub async fn load_scene(&self, name: &str) -> Result<(), scene::SceneError> {
        let s = scene::load(&self.scenes_dir(), name)?;
        let mut params = self.params.write().await;
        *params = s.params;
        Ok(())
    }
}

pub type SharedState = Arc<AppState>;
