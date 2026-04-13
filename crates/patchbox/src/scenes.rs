use patchbox_core::config::PatchboxConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// A saved scene — snapshot of routing matrix + gains
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub is_favourite: bool,
    pub matrix: Vec<Vec<bool>>,
    pub input_gain_db: Vec<f32>,
    pub output_gain_db: Vec<f32>,
}

impl Scene {
    pub fn from_config(name: impl Into<String>, config: &PatchboxConfig, description: Option<String>) -> Self {
        Self {
            name: name.into(),
            description,
            is_favourite: false,
            matrix: config.matrix.clone(),
            input_gain_db: config.input_gain_db.clone(),
            output_gain_db: config.output_gain_db.clone(),
        }
    }

    pub fn apply_to_config(&self, config: &mut PatchboxConfig) {
        // Only apply if dimensions match
        if self.matrix.len() == config.tx_channels
            && self.matrix.iter().all(|r| r.len() == config.rx_channels)
        {
            config.matrix = self.matrix.clone();
        }
        if self.input_gain_db.len() == config.rx_channels {
            config.input_gain_db = self.input_gain_db.clone();
        }
        if self.output_gain_db.len() == config.tx_channels {
            config.output_gain_db = self.output_gain_db.clone();
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SceneStore {
    pub scenes: HashMap<String, Scene>,
    pub active: Option<String>,
}

impl SceneStore {
    pub fn load(path: &PathBuf) -> Self {
        if path.exists() {
            let s = std::fs::read_to_string(path).unwrap_or_default();
            toml::from_str(&s).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        let s = toml::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, s).map_err(|e| e.to_string())?;
        Ok(())
    }
}
