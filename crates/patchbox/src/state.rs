use patchbox_core::control::{AudioParams, MeterFrame};
use patchbox_core::scene;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;

pub struct AppState {
    pub config: Config,
    /// Audio parameters — shared between the REST API and the Dante audio bridge.
    /// Both hold clones of this Arc so that API writes are immediately visible
    /// to the RT callback (via `try_read`) and vice versa.
    pub params: Arc<RwLock<AudioParams>>,
    /// Live peak-metering data — written by the RT callback, read by the WS task.
    pub meters: Arc<RwLock<MeterFrame>>,
}

impl AppState {
    pub fn new(cfg: Config) -> Self {
        Self {
            params: Arc::new(RwLock::new(AudioParams::new(cfg.n_inputs, cfg.n_outputs))),
            meters: Arc::new(RwLock::new(MeterFrame::new(cfg.n_inputs, cfg.n_outputs))),
            config: cfg,
        }
    }

    pub fn scenes_dir(&self) -> PathBuf {
        PathBuf::from(&self.config.scenes_dir)
    }

    /// Persist the current params as a named scene.
    pub async fn save_scene(&self, name: &str) -> Result<(), scene::SceneError> {
        let params = self.params.read().await.clone();
        let s = scene::Scene { name: name.to_owned(), params };
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
