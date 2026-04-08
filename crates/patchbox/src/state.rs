use patchbox_core::control::AudioParams;
use patchbox_core::scene;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;

/// Live metering data broadcast to WebSocket clients.
#[derive(Debug, Clone, Serialize)]
pub struct MeterFrame {
    /// One f32 per input channel (dBFS, roughly −60..0).
    pub inputs:  Vec<f32>,
    /// One f32 per output channel.
    pub outputs: Vec<f32>,
}

pub struct AppState {
    pub config: Config,
    /// Audio parameters shared between the control API and the audio bridge.
    pub params: RwLock<AudioParams>,
    /// Latest meter readings (updated by the audio thread).
    pub meters: RwLock<MeterFrame>,
}

impl AppState {
    pub fn new(cfg: Config) -> Self {
        let params = AudioParams::new(cfg.n_inputs, cfg.n_outputs);
        let meters = MeterFrame {
            inputs:  vec![-60.0; cfg.n_inputs],
            outputs: vec![-60.0; cfg.n_outputs],
        };
        Self {
            config: cfg,
            params: RwLock::new(params),
            meters: RwLock::new(meters),
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
