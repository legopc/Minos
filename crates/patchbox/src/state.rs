use patchbox_core::config::PatchboxConfig;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Live meter state — updated by the audio processing task
#[derive(Default, Clone)]
pub struct MeterState {
    /// RMS per TX output (linear)
    pub tx_rms: Vec<f32>,
    /// RMS per RX input (linear)  
    pub rx_rms: Vec<f32>,
}

impl MeterState {
    pub fn new(rx: usize, tx: usize) -> Self {
        Self {
            tx_rms: vec![0.0; tx],
            rx_rms: vec![0.0; rx],
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<RwLock<PatchboxConfig>>,
    pub config_path: PathBuf,
    pub meters: Arc<RwLock<MeterState>>,
}

impl AppState {
    pub fn new(config: PatchboxConfig, config_path: PathBuf) -> Self {
        let meters = MeterState::new(config.rx_channels, config.tx_channels);
        Self {
            config: Arc::new(RwLock::new(config)),
            config_path,
            meters: Arc::new(RwLock::new(meters)),
        }
    }

    /// Persist config to disk
    pub async fn persist(&self) -> Result<(), String> {
        let cfg = self.config.read().await;
        let toml_str = toml::to_string_pretty(&*cfg)
            .map_err(|e| format!("serialize: {}", e))?;
        std::fs::write(&self.config_path, toml_str)
            .map_err(|e| format!("write: {}", e))?;
        Ok(())
    }
}
