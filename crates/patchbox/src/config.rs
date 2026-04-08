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
}

fn dirs_next() -> Option<String> {
    dirs::data_local_dir()
        .map(|d| d.join("patchbox").join("scenes").to_string_lossy().into_owned())
}
