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

    // Legacy fields (kept for backward compat)
    pub matrix: Vec<Vec<bool>>,
    pub input_gain_db: Vec<f32>,
    pub output_gain_db: Vec<f32>,

    // Extended fields
    #[serde(default)]
    pub matrix_gain_db: Vec<Vec<f32>>,
    #[serde(default)]
    pub input_dsp_gain_db: Vec<f32>,
    #[serde(default)]
    pub output_dsp_gain_db: Vec<f32>,
    #[serde(default)]
    pub output_muted: Vec<bool>,
    #[serde(default)]
    pub bus_matrix: Option<Vec<Vec<bool>>>,
}

impl Scene {
    pub fn from_config(name: impl Into<String>, config: &PatchboxConfig, description: Option<String>) -> Self {
        let input_dsp_gain_db: Vec<f32> = config.input_dsp.iter().map(|d| d.gain_db).collect();
        let output_dsp_gain_db: Vec<f32> = config.output_dsp.iter().map(|d| d.gain_db).collect();
        let output_muted: Vec<bool> = config.output_dsp.iter().map(|d| d.muted).collect();
        Self {
            name: name.into(),
            description,
            is_favourite: false,
            matrix: config.matrix.clone(),
            input_gain_db: input_dsp_gain_db.clone(), // keep in sync with dsp
            output_gain_db: output_dsp_gain_db.clone(),
            matrix_gain_db: config.matrix_gain_db.clone(),
            input_dsp_gain_db,
            output_dsp_gain_db,
            output_muted,
            bus_matrix: config.bus_matrix.clone(),
        }
    }

    pub fn apply_to_config(&self, config: &mut PatchboxConfig) {
        // Apply matrix routing
        if self.matrix.len() == config.tx_channels
            && self.matrix.iter().all(|r| r.len() == config.rx_channels)
        {
            config.matrix = self.matrix.clone();
        }

        // Apply matrix_gain_db if dimensions match
        if !self.matrix_gain_db.is_empty()
            && self.matrix_gain_db.len() == config.tx_channels
            && self.matrix_gain_db.iter().all(|r| r.len() == config.rx_channels)
        {
            config.matrix_gain_db = self.matrix_gain_db.clone();
        }

        // Apply input DSP gains (prefer extended field, fall back to legacy)
        if !self.input_dsp_gain_db.is_empty() && self.input_dsp_gain_db.len() == config.rx_channels {
            for (i, dsp) in config.input_dsp.iter_mut().enumerate() {
                if let Some(&g) = self.input_dsp_gain_db.get(i) {
                    dsp.gain_db = g;
                }
            }
            config.input_gain_db = self.input_dsp_gain_db.clone();
        } else if self.input_gain_db.len() == config.rx_channels {
            config.input_gain_db = self.input_gain_db.clone();
            for (i, dsp) in config.input_dsp.iter_mut().enumerate() {
                if let Some(&g) = self.input_gain_db.get(i) {
                    dsp.gain_db = g;
                }
            }
        }

        // Apply output DSP gains (prefer extended field, fall back to legacy)
        if !self.output_dsp_gain_db.is_empty() && self.output_dsp_gain_db.len() == config.tx_channels {
            for (i, dsp) in config.output_dsp.iter_mut().enumerate() {
                if let Some(&g) = self.output_dsp_gain_db.get(i) {
                    dsp.gain_db = g;
                }
            }
            config.output_gain_db = self.output_dsp_gain_db.clone();
        } else if self.output_gain_db.len() == config.tx_channels {
            config.output_gain_db = self.output_gain_db.clone();
            for (i, dsp) in config.output_dsp.iter_mut().enumerate() {
                if let Some(&g) = self.output_gain_db.get(i) {
                    dsp.gain_db = g;
                }
            }
        }

        // Apply output mute state
        if !self.output_muted.is_empty() && self.output_muted.len() == config.tx_channels {
            for (i, dsp) in config.output_dsp.iter_mut().enumerate() {
                if let Some(&m) = self.output_muted.get(i) {
                    dsp.muted = m;
                }
            }
            config.output_muted = self.output_muted.clone();
        }

        // Apply bus matrix if present
        if let Some(ref bm) = self.bus_matrix {
            config.bus_matrix = Some(bm.clone());
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
        use std::io::Write;
        let s = toml::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("scenes.toml.tmp");
        {
            let mut f = std::fs::OpenOptions::new()
                .write(true).create(true).truncate(true)
                .open(&tmp).map_err(|e| e.to_string())?;
            f.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
        }
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    }
}
