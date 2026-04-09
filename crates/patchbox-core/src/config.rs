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
    /// Dante device name as seen on the network
    pub dante_name: String,
    /// Network interface for Dante
    pub dante_nic: String,
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
            dante_name: "patchbox".to_string(),
            dante_nic: "eth0".to_string(),
            port: 9191,
        }
    }
}
