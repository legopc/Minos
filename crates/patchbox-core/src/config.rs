//! Configuration types — loaded from config.toml

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchboxConfig {
    /// Number of Dante RX channels (sources in)
    pub rx_channels: usize,
    /// Number of Dante TX channels (zone outputs)
    pub tx_channels: usize,
    /// Human-readable zone names (len == tx_channels)
    pub zones: Vec<String>,
    /// Human-readable source names (len == rx_channels)
    pub sources: Vec<String>,
    /// Per-input gain in dB (len == rx_channels)
    pub input_gain_db: Vec<f32>,
    /// Per-output volume in dB (len == tx_channels)
    pub output_gain_db: Vec<f32>,
    /// Routing matrix: matrix[tx][rx] = true means source rx feeds zone tx
    pub matrix: Vec<Vec<bool>>,
    /// Per-zone mute state (true = muted/silent)
    #[serde(default)]
    pub output_muted: Vec<bool>,
    /// Dante device name as seen on the network
    pub dante_name: String,
    /// Network interface for Dante
    pub dante_nic: String,
    /// Path to statime PTP clock socket (default: /tmp/ptp-usrvclock)
    #[serde(default = "default_clock_path")]
    pub dante_clock_path: String,
    /// HTTP server port for web UI + API
    pub port: u16,
}

impl Default for PatchboxConfig {
    fn default() -> Self {
        let rx = 4;
        let tx = 2;
        Self {
            rx_channels: rx,
            tx_channels: tx,
            zones: (1..=tx).map(|i| format!("Zone {}", i)).collect(),
            sources: (1..=rx).map(|i| format!("Source {}", i)).collect(),
            input_gain_db: vec![0.0; rx],
            output_gain_db: vec![0.0; tx],
            matrix: vec![vec![false; rx]; tx],
            output_muted: vec![false; tx],
            dante_name: "patchbox".to_string(),
            dante_nic: "eth0".to_string(),
            dante_clock_path: default_clock_path(),
            port: 9191,
        }
    }
}

impl PatchboxConfig {
    /// Ensure all Vec fields are sized to match rx_channels / tx_channels.
    /// Call after loading config from disk to handle configs missing new fields.
    pub fn normalize(&mut self) {
        self.output_muted.resize(self.tx_channels, false);
        self.input_gain_db.resize(self.rx_channels, 0.0);
        self.output_gain_db.resize(self.tx_channels, 0.0);
        self.matrix.resize(self.tx_channels, vec![false; self.rx_channels]);
        for row in &mut self.matrix {
            row.resize(self.rx_channels, false);
        }
    }
}

fn default_clock_path() -> String {
    "/tmp/ptp-usrvclock".to_string()
}
