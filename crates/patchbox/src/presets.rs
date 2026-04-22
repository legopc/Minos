// S7 s7-feat-presets — DSP block preset library.
//
// Scope: save / load / export / import per-block presets keyed by block type.
// Storage: presets.toml next to config.toml.
//
// API:
//   GET    /api/v1/presets                     — list all presets grouped by block
//   POST   /api/v1/presets/:name               — save { block, params } as named preset
//   POST   /api/v1/presets/:name/recall        — return preset params (client applies)
//   DELETE /api/v1/presets/:name?block=cmp     — remove a named preset for a block

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PresetLibrary {
    /// keyed by block-id (peq, cmp, deq, ...) then preset name.
    pub blocks: BTreeMap<String, BTreeMap<String, serde_json::Value>>,
}

impl PresetLibrary {
    #[allow(dead_code)]
    pub fn new() -> Self { Self::default() }

    pub fn insert(&mut self, block: &str, name: &str, value: serde_json::Value) {
        self.blocks.entry(block.to_string()).or_default().insert(name.to_string(), value);
    }

    pub fn get(&self, block: &str, name: &str) -> Option<&serde_json::Value> {
        self.blocks.get(block)?.get(name)
    }

    pub fn remove(&mut self, block: &str, name: &str) -> Option<serde_json::Value> {
        self.blocks.get_mut(block)?.remove(name)
    }

    /// Load from a TOML file. Returns an empty library if the file does not exist.
    pub fn load_from_file(path: &Path) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = std::fs::read_to_string(path)?;
        let lib: Self = toml::from_str(&text)?;
        Ok(lib)
    }

    /// Persist to a TOML file atomically (write to `.tmp` then rename).
    pub fn save_to_file(&self, path: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let text = toml::to_string_pretty(self)?;
        let tmp = path.with_extension("toml.tmp");
        std::fs::write(&tmp, &text)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}
