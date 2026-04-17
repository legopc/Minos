// S7 s7-feat-presets — DSP block preset library.
//
// Scope: save / load / export / import per-block presets keyed by block type.
// Storage: presets.toml next to config.toml, or embedded in config as `[presets.<block>]`.
//
// API:
//   GET    /presets                   — list all presets grouped by block type
//   GET    /presets/:block            — list presets for one block
//   POST   /presets/:block            — create { name, params }
//   GET    /presets/:block/:name      — fetch one preset
//   DELETE /presets/:block/:name      — remove
//   POST   /presets/:block/:name/apply?target=input:5  — apply preset to target
//
// UI: preset dropdown on every DSP panel (load / save-as / delete).

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PresetLibrary {
    /// keyed by block-id (peq, cmp, deq, ...) then preset name.
    pub blocks: BTreeMap<String, BTreeMap<String, serde_json::Value>>,
}

impl PresetLibrary {
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
}
