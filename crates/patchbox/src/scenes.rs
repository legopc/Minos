use patchbox_core::config::{
    AutomixerGroupConfig, InputChannelDsp, InternalBusConfig, OutputChannelDsp, PatchboxConfig,
    SignalGeneratorConfig, StereoLinkConfig, VcaGroupConfig,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

const SCENE_SCHEMA_V1: u32 = 1;
const SCENE_SCHEMA_V2: u32 = 2;

fn scene_schema_v1() -> u32 {
    SCENE_SCHEMA_V1
}

fn recall_enabled_default() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema, PartialEq, Eq)]
pub struct RecallScope {
    #[serde(default = "recall_enabled_default")]
    pub routing: bool,
    #[serde(default = "recall_enabled_default")]
    pub inputs: bool,
    #[serde(default = "recall_enabled_default")]
    pub outputs: bool,
    #[serde(default = "recall_enabled_default")]
    pub buses: bool,
    #[serde(default = "recall_enabled_default")]
    pub groups: bool,
    #[serde(default = "recall_enabled_default")]
    pub generators: bool,
}

impl Default for RecallScope {
    fn default() -> Self {
        Self {
            routing: true,
            inputs: true,
            outputs: true,
            buses: true,
            groups: true,
            generators: true,
        }
    }
}

impl RecallScope {
    pub fn is_full(&self) -> bool {
        self.routing && self.inputs && self.outputs && self.buses && self.groups && self.generators
    }

    pub fn section_key_for_path(&self, path: &str, schema_version: u32) -> Option<&'static str> {
        let top_level = path
            .split(['.', '['])
            .find(|part| !part.is_empty())
            .unwrap_or("");

        if schema_version >= SCENE_SCHEMA_V2 {
            match top_level {
                "matrix" | "matrix_gain_db" if self.routing => Some("routing"),
                "input_dsp" if self.inputs => Some("inputs"),
                "output_dsp" if self.outputs => Some("outputs"),
                "internal_buses" | "bus_matrix" | "bus_feed_matrix" if self.buses => Some("buses"),
                "vca_groups" | "stereo_links" | "output_stereo_links" | "automixer_groups"
                    if self.groups =>
                {
                    Some("groups")
                }
                "signal_generators" | "generator_bus_matrix" if self.generators => {
                    Some("generators")
                }
                _ => None,
            }
        } else {
            match top_level {
                "matrix" | "matrix_gain_db" if self.routing => Some("routing"),
                "input_gain_db" | "input_dsp_gain_db" if self.inputs => Some("inputs"),
                "output_gain_db" | "output_dsp_gain_db" | "output_muted" if self.outputs => {
                    Some("outputs")
                }
                "bus_matrix" if self.buses => Some("buses"),
                _ => None,
            }
        }
    }

    pub fn section_label(key: &str) -> &'static str {
        match key {
            "routing" => "Routing",
            "inputs" => "Inputs",
            "outputs" => "Outputs",
            "buses" => "Buses",
            "groups" => "Groups",
            "generators" => "Generators",
            _ => "Other",
        }
    }
}

/// A saved scene — snapshot of routing matrix + gains
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct Scene {
    #[serde(default = "scene_schema_v1")]
    pub schema_version: u32,
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
    #[serde(default)]
    pub input_dsp: Vec<InputChannelDsp>,
    #[serde(default)]
    pub output_dsp: Vec<OutputChannelDsp>,
    #[serde(default)]
    pub internal_buses: Vec<InternalBusConfig>,
    #[serde(default)]
    pub bus_feed_matrix: Option<Vec<Vec<bool>>>,
    #[serde(default)]
    pub vca_groups: Vec<VcaGroupConfig>,
    #[serde(default)]
    pub stereo_links: Vec<StereoLinkConfig>,
    #[serde(default)]
    pub output_stereo_links: Vec<StereoLinkConfig>,
    #[serde(default)]
    pub automixer_groups: Vec<AutomixerGroupConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal_generators: Option<Vec<SignalGeneratorConfig>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generator_bus_matrix: Option<Vec<Vec<f32>>>,
}

impl Scene {
    pub fn from_config(
        name: impl Into<String>,
        config: &PatchboxConfig,
        description: Option<String>,
    ) -> Self {
        let input_dsp: Vec<_> = config
            .input_dsp
            .iter()
            .take(config.rx_channels)
            .cloned()
            .collect();
        let output_dsp: Vec<_> = config
            .output_dsp
            .iter()
            .take(config.tx_channels)
            .cloned()
            .collect();
        let input_dsp_gain_db: Vec<f32> = input_dsp.iter().map(|d| d.gain_db).collect();
        let output_dsp_gain_db: Vec<f32> = output_dsp.iter().map(|d| d.gain_db).collect();
        let output_muted: Vec<bool> = output_dsp.iter().map(|d| d.muted).collect();
        Self {
            schema_version: SCENE_SCHEMA_V2,
            name: name.into(),
            description,
            is_favourite: false,
            matrix: config.matrix.clone(),
            input_gain_db: input_dsp_gain_db.clone(),
            output_gain_db: output_dsp_gain_db.clone(),
            matrix_gain_db: config.matrix_gain_db.clone(),
            input_dsp_gain_db,
            output_dsp_gain_db,
            output_muted,
            bus_matrix: config.bus_matrix.clone(),
            input_dsp,
            output_dsp,
            internal_buses: config.internal_buses.clone(),
            bus_feed_matrix: config.bus_feed_matrix.clone(),
            vca_groups: config.vca_groups.clone(),
            stereo_links: config.stereo_links.clone(),
            output_stereo_links: config.output_stereo_links.clone(),
            automixer_groups: config.automixer_groups.clone(),
            signal_generators: Some(config.signal_generators.clone()),
            generator_bus_matrix: Some(config.generator_bus_matrix.clone()),
        }
    }

    #[allow(dead_code)]
    pub fn apply_to_config(&self, config: &mut PatchboxConfig) {
        self.apply_to_config_scoped(config, &RecallScope::default());
    }

    pub fn apply_to_config_scoped(&self, config: &mut PatchboxConfig, scope: &RecallScope) {
        if self.schema_version >= SCENE_SCHEMA_V2 {
            self.apply_v2_scoped(config, scope);
            return;
        }
        self.apply_v1_legacy(config, scope);
    }

    fn apply_v1_legacy(&self, config: &mut PatchboxConfig, scope: &RecallScope) {
        if scope.routing {
            self.apply_matrix_snapshot(config);
        }
        if scope.inputs {
            self.apply_input_gain_snapshot(config);
        }
        if scope.outputs {
            self.apply_output_gain_snapshot(config);
            self.apply_output_mute_snapshot(config);
        }

        if scope.buses {
            if let Some(ref bm) = self.bus_matrix {
                config.bus_matrix = Some(bm.clone());
            }
        }

        config.normalize();
        self.sync_legacy_mirrors(config);
    }

    fn apply_v2_scoped(&self, config: &mut PatchboxConfig, scope: &RecallScope) {
        if scope.routing {
            self.apply_matrix_snapshot(config);
        }

        if scope.inputs {
            let input_dsp_applied = if self.input_dsp.len() >= config.rx_channels {
                config.input_dsp = self
                    .input_dsp
                    .iter()
                    .take(config.rx_channels)
                    .cloned()
                    .collect();
                true
            } else {
                false
            };

            if !input_dsp_applied {
                self.apply_input_gain_snapshot(config);
            }
        }

        if scope.outputs {
            let output_dsp_applied = if self.output_dsp.len() >= config.tx_channels {
                config.output_dsp = self
                    .output_dsp
                    .iter()
                    .take(config.tx_channels)
                    .cloned()
                    .collect();
                true
            } else {
                false
            };

            if !output_dsp_applied {
                self.apply_output_gain_snapshot(config);
                self.apply_output_mute_snapshot(config);
            }
        }

        if scope.buses {
            config.internal_buses = self.internal_buses.clone();
            config.bus_matrix = self.bus_matrix.clone();
            config.bus_feed_matrix = self.bus_feed_matrix.clone();
        }

        if scope.groups {
            config.vca_groups = self.vca_groups.clone();
            config.stereo_links = self.stereo_links.clone();
            config.output_stereo_links = self.output_stereo_links.clone();
            config.automixer_groups = self.automixer_groups.clone();
        }

        if scope.generators {
            if let Some(signal_generators) = &self.signal_generators {
                config.signal_generators = signal_generators.clone();
            }
            if let Some(generator_bus_matrix) = &self.generator_bus_matrix {
                config.generator_bus_matrix = generator_bus_matrix.clone();
            }
        }

        config.normalize();
        self.sync_legacy_mirrors(config);
    }

    fn apply_matrix_snapshot(&self, config: &mut PatchboxConfig) {
        if self.matrix.len() == config.tx_channels
            && self.matrix.iter().all(|r| r.len() == config.rx_channels)
        {
            config.matrix = self.matrix.clone();
        }

        if !self.matrix_gain_db.is_empty()
            && self.matrix_gain_db.len() == config.tx_channels
            && self
                .matrix_gain_db
                .iter()
                .all(|r| r.len() == config.rx_channels)
        {
            config.matrix_gain_db = self.matrix_gain_db.clone();
        }
    }

    fn apply_input_gain_snapshot(&self, config: &mut PatchboxConfig) {
        if self.input_dsp_gain_db.len() >= config.rx_channels {
            let gains: Vec<_> = self
                .input_dsp_gain_db
                .iter()
                .take(config.rx_channels)
                .copied()
                .collect();
            for (i, dsp) in config.input_dsp.iter_mut().enumerate() {
                if let Some(&g) = gains.get(i) {
                    dsp.gain_db = g;
                }
            }
            config.input_gain_db = gains;
        } else if self.input_gain_db.len() >= config.rx_channels {
            let gains: Vec<_> = self
                .input_gain_db
                .iter()
                .take(config.rx_channels)
                .copied()
                .collect();
            config.input_gain_db = gains.clone();
            for (i, dsp) in config.input_dsp.iter_mut().enumerate() {
                if let Some(&g) = gains.get(i) {
                    dsp.gain_db = g;
                }
            }
        }
    }

    fn apply_output_gain_snapshot(&self, config: &mut PatchboxConfig) {
        if self.output_dsp_gain_db.len() >= config.tx_channels {
            let gains: Vec<_> = self
                .output_dsp_gain_db
                .iter()
                .take(config.tx_channels)
                .copied()
                .collect();
            for (i, dsp) in config.output_dsp.iter_mut().enumerate() {
                if let Some(&g) = gains.get(i) {
                    dsp.gain_db = g;
                }
            }
            config.output_gain_db = gains;
        } else if self.output_gain_db.len() >= config.tx_channels {
            let gains: Vec<_> = self
                .output_gain_db
                .iter()
                .take(config.tx_channels)
                .copied()
                .collect();
            config.output_gain_db = gains.clone();
            for (i, dsp) in config.output_dsp.iter_mut().enumerate() {
                if let Some(&g) = gains.get(i) {
                    dsp.gain_db = g;
                }
            }
        }
    }

    fn apply_output_mute_snapshot(&self, config: &mut PatchboxConfig) {
        if self.output_muted.len() >= config.tx_channels {
            let muted: Vec<_> = self
                .output_muted
                .iter()
                .take(config.tx_channels)
                .copied()
                .collect();
            for (i, dsp) in config.output_dsp.iter_mut().enumerate() {
                if let Some(&m) = muted.get(i) {
                    dsp.muted = m;
                }
            }
            config.output_muted = muted;
        }
    }

    fn sync_legacy_mirrors(&self, config: &mut PatchboxConfig) {
        config.input_gain_db = config
            .input_dsp
            .iter()
            .take(config.rx_channels)
            .map(|dsp| dsp.gain_db)
            .collect();
        config.output_gain_db = config
            .output_dsp
            .iter()
            .take(config.tx_channels)
            .map(|dsp| dsp.gain_db)
            .collect();
        config.output_muted = config
            .output_dsp
            .iter()
            .take(config.tx_channels)
            .map(|dsp| dsp.muted)
            .collect();
        config.per_output_eq = config
            .output_dsp
            .iter()
            .take(config.tx_channels)
            .map(|dsp| dsp.eq.clone())
            .collect();
        config.per_output_limiter = config
            .output_dsp
            .iter()
            .take(config.tx_channels)
            .map(|dsp| dsp.limiter.clone())
            .collect();
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
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp)
                .map_err(|e| e.to_string())?;
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
