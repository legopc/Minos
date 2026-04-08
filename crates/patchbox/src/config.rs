use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// S-05: Role for an API key. Controls which endpoints are accessible.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Full system access — config, scenes, matrix, all zones.
    Admin,
    /// Can change matrix routing and scenes. Cannot modify config.
    Operator,
    /// Can adjust gain/mute within their assigned zone only.
    BarStaff,
    /// Can read state but cannot modify anything.
    ReadOnly,
}

impl Default for Role {
    fn default() -> Self { Role::ReadOnly }
}

/// Entry in the api_keys map: a human label + role.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyEntry {
    pub label: String,
    #[serde(default)]
    pub role:  Role,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// HTTP port for the web UI and API.
    pub port: u16,
    /// Number of Dante RX (input) channels.
    pub n_inputs:  usize,
    /// Number of Dante TX (output) channels.
    pub n_outputs: usize,
    /// Dante device name visible on the network.
    pub device_name: String,
    /// Directory for TOML scene files.
    pub scenes_dir: String,
    /// CORS allowed origins. Empty list means same-origin only (production default).
    /// Add `"http://localhost:<port>"` for local development.
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    /// S-01 + S-05: API keys. Map of token → {label, role}.
    /// Empty = auth disabled (development default). When non-empty, every API
    /// request must include `X-Api-Key: <token>` or `Authorization: Bearer <token>`.
    #[serde(default)]
    pub api_keys: HashMap<String, ApiKeyEntry>,
    /// Zone definitions for the bar view (U-01).
    /// Map of zone-id → list of output indices that belong to that zone.
    /// e.g. `{ "bar-1": [0, 1], "bar-2": [2, 3] }`
    #[serde(default)]
    pub zones: HashMap<String, Vec<usize>>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port:            8080,
            n_inputs:        8,
            n_outputs:       8,
            device_name:     "dante-patchbox".to_owned(),
            scenes_dir:      dirs_next().unwrap_or_else(|| "/var/lib/patchbox/scenes".to_owned()),
            allowed_origins: vec![],
            api_keys:        HashMap::new(),
            zones:           HashMap::new(),
        }
    }
}

impl Config {
    pub fn load(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let src = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&src)?)
    }

    /// Validate config values. Returns an error string describing the first problem found.
    pub fn validate(&self) -> Result<(), String> {
        if self.port < 1024 {
            return Err(format!("port {} is < 1024 (reserved)", self.port));
        }
        if self.n_inputs == 0 || self.n_inputs > 64 {
            return Err(format!("n_inputs {} must be 1–64", self.n_inputs));
        }
        if self.n_outputs == 0 || self.n_outputs > 64 {
            return Err(format!("n_outputs {} must be 1–64", self.n_outputs));
        }
        if self.device_name.trim().is_empty() {
            return Err("device_name must not be empty".into());
        }
        if self.device_name.len() > 64 {
            return Err(format!("device_name exceeds 64 characters: {}", self.device_name));
        }
        if self.scenes_dir.trim().is_empty() {
            return Err("scenes_dir must not be empty".into());
        }
        Ok(())
    }
}

fn dirs_next() -> Option<String> {
    dirs::data_local_dir()
        .map(|d| d.join("patchbox").join("scenes").to_string_lossy().into_owned())
}
