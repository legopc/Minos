//! Configuration types — loaded from config.toml

use serde::{Deserialize, Serialize};

/// One band of a parametric EQ.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqBand {
    /// Centre frequency in Hz (20–20000)
    pub freq_hz: f32,
    /// Gain in dB (-24 to +24)
    pub gain_db: f32,
    /// Q factor (0.1–10.0); higher = narrower band
    pub q: f32,
}

impl Default for EqBand {
    fn default() -> Self {
        Self { freq_hz: 1000.0, gain_db: 0.0, q: 0.707 }
    }
}

/// Per-output 3-band parametric EQ.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqConfig {
    pub bands: [EqBand; 3],
    #[serde(default)]
    pub enabled: bool,
}

impl Default for EqConfig {
    fn default() -> Self {
        Self {
            // Low shelf ~100Hz, mid parametric ~1kHz, high shelf ~8kHz
            bands: [
                EqBand { freq_hz: 100.0, gain_db: 0.0, q: 0.707 },
                EqBand { freq_hz: 1000.0, gain_db: 0.0, q: 0.707 },
                EqBand { freq_hz: 8000.0, gain_db: 0.0, q: 0.707 },
            ],
            enabled: false,
        }
    }
}

/// Per-output brick-wall limiter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimiterConfig {
    /// Threshold in dBFS above which limiting engages (-40 to 0)
    pub threshold_db: f32,
    /// Attack time in milliseconds (0.1–50)
    pub attack_ms: f32,
    /// Release time in milliseconds (10–2000)
    pub release_ms: f32,
    #[serde(default)]
    pub enabled: bool,
}

impl Default for LimiterConfig {
    fn default() -> Self {
        Self {
            threshold_db: -1.0,
            attack_ms: 1.0,
            release_ms: 100.0,
            enabled: false,
        }
    }
}

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
    /// Per-output 3-band parametric EQ (len == tx_channels)
    #[serde(default)]
    pub per_output_eq: Vec<EqConfig>,
    /// Per-output brick-wall limiter (len == tx_channels)
    #[serde(default)]
    pub per_output_limiter: Vec<LimiterConfig>,
    /// Dante device name as seen on the network
    pub dante_name: String,
    /// Network interface for Dante
    pub dante_nic: String,
    /// Path to statime PTP clock socket (default: /tmp/ptp-usrvclock)
    #[serde(default = "default_clock_path")]
    pub dante_clock_path: String,
    /// HTTP server port for web UI + API
    pub port: u16,
    /// RX jitter buffer depth in samples (48000 Hz). Default 48 = 1 ms on clean LAN.
    /// Increase to 96 (2ms) or 192 (4ms) if audio drops out.
    #[serde(default = "default_rx_jitter_samples")]
    pub rx_jitter_samples: usize,
    /// TX ring write-ahead in samples. Default 48 = 1 ms.
    /// Increase to 96 if pops/clicks occur after reducing rx_jitter_samples.
    #[serde(default = "default_lead_samples")]
    pub lead_samples: usize,
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
            per_output_eq: vec![EqConfig::default(); tx],
            per_output_limiter: vec![LimiterConfig::default(); tx],
            dante_name: "patchbox".to_string(),
            dante_nic: "eth0".to_string(),
            dante_clock_path: default_clock_path(),
            port: 9191,
            rx_jitter_samples: default_rx_jitter_samples(),
            lead_samples: default_lead_samples(),
        }
    }
}

impl PatchboxConfig {
    /// Ensure all Vec fields are sized to match rx_channels / tx_channels.
    /// Call after loading config from disk to handle configs missing new fields.
    pub fn normalize(&mut self) {
        self.output_muted.resize(self.tx_channels, false);
        self.per_output_eq.resize_with(self.tx_channels, EqConfig::default);
        self.per_output_limiter.resize_with(self.tx_channels, LimiterConfig::default);
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

fn default_rx_jitter_samples() -> usize {
    48
}

fn default_lead_samples() -> usize {
    48
}
