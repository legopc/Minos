use serde::{Deserialize, Serialize};

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
