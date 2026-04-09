use patchbox_core::config::PatchboxConfig;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<RwLock<PatchboxConfig>>,
    pub config_path: PathBuf,
}

impl AppState {
    pub fn new(config: PatchboxConfig, config_path: PathBuf) -> Self {
        Self {
            config: Arc::new(RwLock::new(config)),
            config_path,
        }
    }

    pub async fn persist(&self) -> Result<(), String> {
        let cfg = self.config.read().await;
        let toml_str = toml::to_string_pretty(&*cfg)
            .map_err(|e| format!("serialize error: {}", e))?;
        std::fs::write(&self.config_path, toml_str)
            .map_err(|e| format!("write error: {}", e))?;
        Ok(())
    }
}
