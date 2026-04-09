use patchbox_core::config::PatchboxConfig;
pub use patchbox_core::meters::MeterState;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
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
}

impl AppState {
    pub fn new(config: PatchboxConfig, config_path: PathBuf) -> Self {
        let scenes_path = config_path.with_extension("scenes.toml");
        let scenes = SceneStore::load(&scenes_path);
        let meters = MeterState::new(config.rx_channels, config.tx_channels);
        let jwt_secret = jwt::generate_secret();
        Self {
            config: Arc::new(RwLock::new(config)),
            config_path,
            meters: Arc::new(RwLock::new(meters)),
            scenes: Arc::new(RwLock::new(scenes)),
            scenes_path,
            jwt_secret: Arc::new(RwLock::new(jwt_secret)),
        }
    }

    pub async fn persist(&self) -> Result<(), String> {
        let cfg = self.config.read().await;
        let s = toml::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
        let tmp_path = self.config_path.with_extension("toml.tmp");
        std::fs::write(&tmp_path, &s).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp_path, &self.config_path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn persist_scenes(&self) -> Result<(), String> {
        let store = self.scenes.read().await;
        store.save(&self.scenes_path)
    }
}
