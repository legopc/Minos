//! Configuration types — loaded from config.toml

use serde::{Deserialize, Deserializer, Serialize};

/// EQ band filter type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EqBandType {
    LowShelf,
    Peaking,
    HighShelf,
}

impl Default for EqBandType {
    fn default() -> Self {
        EqBandType::Peaking
    }
}

/// One band of a parametric EQ.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqBand {
    /// Centre frequency in Hz (20–20000)
    pub freq_hz: f32,
    /// Gain in dB (-24 to +24)
    pub gain_db: f32,
    /// Q factor (0.1–10.0); higher = narrower band
    pub q: f32,
    #[serde(default)]
    pub band_type: EqBandType,
}

impl Default for EqBand {
    fn default() -> Self {
        Self { freq_hz: 1000.0, gain_db: 0.0, q: 0.707, band_type: EqBandType::Peaking }
    }
}

/// Per-output 5-band EQ.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqConfig {
    #[serde(deserialize_with = "deser_eq_bands", default = "EqConfig::default_bands")]
    pub bands: [EqBand; 5],
    #[serde(default)]
    pub enabled: bool,
}

fn deser_eq_bands<'de, D>(deserializer: D) -> Result<[EqBand; 5], D::Error>
where D: Deserializer<'de>
{
    let v = Vec::<EqBand>::deserialize(deserializer)?;
    let mut bands = EqConfig::default_bands();
    for (i, b) in v.into_iter().take(5).enumerate() {
        bands[i] = b;
    }
    Ok(bands)
}

impl EqConfig {
    pub fn default_bands() -> [EqBand; 5] {
        [
            EqBand { freq_hz: 100.0,   gain_db: 0.0, q: 0.707, band_type: EqBandType::LowShelf },
            EqBand { freq_hz: 250.0,   gain_db: 0.0, q: 0.707, band_type: EqBandType::Peaking },
            EqBand { freq_hz: 1000.0,  gain_db: 0.0, q: 0.707, band_type: EqBandType::Peaking },
            EqBand { freq_hz: 4000.0,  gain_db: 0.0, q: 0.707, band_type: EqBandType::Peaking },
            EqBand { freq_hz: 10000.0, gain_db: 0.0, q: 0.707, band_type: EqBandType::HighShelf },
        ]
    }
}

impl Default for EqConfig {
    fn default() -> Self {
        Self {
            bands: Self::default_bands(),
            enabled: false,
        }
    }
}

/// High-pass or low-pass filter config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterConfig {
    #[serde(default)]
    pub enabled: bool,
    pub freq_hz: f32,
}

/// HPF default (80 Hz).
pub fn default_hpf() -> FilterConfig {
    FilterConfig { enabled: false, freq_hz: 80.0 }
}

/// LPF default (16 kHz).
pub fn default_lpf() -> FilterConfig {
    FilterConfig { enabled: false, freq_hz: 16000.0 }
}

impl Default for FilterConfig {
    fn default() -> Self {
        default_hpf()
    }
}

/// Noise gate / expander.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "GateConfig::default_threshold_db")]
    pub threshold_db: f32,
    #[serde(default = "GateConfig::default_ratio")]
    pub ratio: f32,
    #[serde(default = "GateConfig::default_attack_ms")]
    pub attack_ms: f32,
    #[serde(default = "GateConfig::default_hold_ms")]
    pub hold_ms: f32,
    #[serde(default = "GateConfig::default_release_ms")]
    pub release_ms: f32,
    #[serde(default = "GateConfig::default_range_db")]
    pub range_db: f32,
}

impl GateConfig {
    fn default_threshold_db() -> f32 { -60.0 }
    fn default_ratio() -> f32 { 10.0 }
    fn default_attack_ms() -> f32 { 1.0 }
    fn default_hold_ms() -> f32 { 50.0 }
    fn default_release_ms() -> f32 { 200.0 }
    fn default_range_db() -> f32 { -60.0 }
}

impl Default for GateConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            threshold_db: Self::default_threshold_db(),
            ratio: Self::default_ratio(),
            attack_ms: Self::default_attack_ms(),
            hold_ms: Self::default_hold_ms(),
            release_ms: Self::default_release_ms(),
            range_db: Self::default_range_db(),
        }
    }
}

/// Dynamics compressor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressorConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "CompressorConfig::default_threshold_db")]
    pub threshold_db: f32,
    #[serde(default = "CompressorConfig::default_ratio")]
    pub ratio: f32,
    #[serde(default = "CompressorConfig::default_knee_db")]
    pub knee_db: f32,
    #[serde(default = "CompressorConfig::default_attack_ms")]
    pub attack_ms: f32,
    #[serde(default = "CompressorConfig::default_release_ms")]
    pub release_ms: f32,
    #[serde(default)]
    pub makeup_db: f32,
}

impl CompressorConfig {
    fn default_threshold_db() -> f32 { -18.0 }
    fn default_ratio() -> f32 { 4.0 }
    fn default_knee_db() -> f32 { 6.0 }
    fn default_attack_ms() -> f32 { 10.0 }
    fn default_release_ms() -> f32 { 100.0 }
}

impl Default for CompressorConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            threshold_db: Self::default_threshold_db(),
            ratio: Self::default_ratio(),
            knee_db: Self::default_knee_db(),
            attack_ms: Self::default_attack_ms(),
            release_ms: Self::default_release_ms(),
            makeup_db: 0.0,
        }
    }
}

/// Sample-accurate delay line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelayConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Delay in ms, clamped 0–500.
    #[serde(default)]
    pub delay_ms: f32,
}

impl Default for DelayConfig {
    fn default() -> Self {
        Self { enabled: false, delay_ms: 0.0 }
    }
}

/// Full DSP chain for one input channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputChannelDsp {
    #[serde(default = "default_channel_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub gain_db: f32,
    /// true = invert polarity
    #[serde(default)]
    pub polarity: bool,
    #[serde(default = "default_hpf")]
    pub hpf: FilterConfig,
    #[serde(default = "default_lpf")]
    pub lpf: FilterConfig,
    #[serde(default)]
    pub eq: EqConfig,
    #[serde(default)]
    pub gate: GateConfig,
    #[serde(default)]
    pub compressor: CompressorConfig,
}

impl Default for InputChannelDsp {
    fn default() -> Self {
        Self {
            enabled: true,
            gain_db: 0.0,
            polarity: false,
            hpf: default_hpf(),
            lpf: default_lpf(),
            eq: EqConfig::default(),
            gate: GateConfig::default(),
            compressor: CompressorConfig::default(),
        }
    }
}

/// Full DSP chain for one output channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputChannelDsp {
    #[serde(default = "default_channel_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub muted: bool,
    /// true = invert polarity
    #[serde(default)]
    pub polarity: bool,
    #[serde(default = "default_hpf")]
    pub hpf: FilterConfig,
    #[serde(default = "default_lpf")]
    pub lpf: FilterConfig,
    #[serde(default)]
    pub eq: EqConfig,
    #[serde(default)]
    pub compressor: CompressorConfig,
    #[serde(default)]
    pub limiter: LimiterConfig,
    #[serde(default)]
    pub delay: DelayConfig,
    /// TPDF dither bit depth. 0 = disabled; 16 or 24 typical.
    #[serde(default)]
    pub dither_bits: u8,
}

impl Default for OutputChannelDsp {
    fn default() -> Self {
        Self {
            enabled: true,
            gain_db: 0.0,
            muted: false,
            polarity: false,
            hpf: default_hpf(),
            lpf: default_lpf(),
            eq: EqConfig::default(),
            compressor: CompressorConfig::default(),
            limiter: LimiterConfig::default(),
            delay: DelayConfig::default(),
            dither_bits: 0,
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

/// Zone grouping — a named set of TX output channels with a palette colour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneConfig {
    /// Stable string ID synthesised as "zone_{n}"
    pub id: String,
    /// Human-readable display name
    pub name: String,
    /// Colour palette index 0-9, maps to --zone-color-{n} CSS var
    #[serde(default)]
    pub colour_index: u8,
    /// TX channel IDs belonging to this zone, e.g. ["tx_0"]
    #[serde(default)]
    pub tx_ids: Vec<String>,
}

/// Internal submix bus — N RX inputs summed and DSP-processed, then routable to TX outputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalBusConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub routing: Vec<bool>,       // len == rx_channels, which RX inputs feed this bus
    #[serde(default)]
    pub routing_gain: Vec<f32>,   // len == rx_channels, per-input gain in dB (0.0 = unity)
    #[serde(default)]
    pub dsp: InputChannelDsp,
    #[serde(default)]
    pub muted: bool,
}

impl Default for InternalBusConfig {
    fn default() -> Self {
        Self {
            id: "bus_0".to_string(),
            name: "Bus 1".to_string(),
            routing: vec![],
            routing_gain: vec![],
            dsp: InputChannelDsp::default(),
            muted: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum VcaGroupType {
    #[serde(rename = "input")]
    Input,
    #[serde(rename = "output")]
    Output,
}
impl Default for VcaGroupType { fn default() -> Self { Self::Input } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VcaGroupConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub muted: bool,
    /// Member channel IDs: "rx_0", "tx_2", etc.
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub group_type: VcaGroupType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StereoLinkConfig {
    /// Left channel index (0-based rx index, should be even)
    pub left_channel: usize,
    /// Right channel index (0-based rx index, = left + 1)
    pub right_channel: usize,
    #[serde(default = "default_true")]
    pub linked: bool,
    /// Pan -1.0 (full left) to +1.0 (full right), 0.0 = center.
    /// NOTE: stored but not applied in RT path (future: RT pan).
    #[serde(default)]
    pub pan: f32,
}

fn default_gen_freq() -> f32 { 1000.0 }
fn default_gen_level() -> f32 { -20.0 }

/// Type of built-in signal generator
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SignalGenType {
    #[default]
    Sine,
    WhiteNoise,
    PinkNoise,
}

/// Built-in test-signal generator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalGeneratorConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub gen_type: SignalGenType,
    #[serde(default = "default_gen_freq")]
    pub freq_hz: f32,
    /// Output level in dB. f32::NEG_INFINITY = silent.
    #[serde(default = "default_gen_level")]
    pub level_db: f32,
    #[serde(default)]
    pub enabled: bool,
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
    /// Per-crosspoint gain in dB: matrix_gain_db[tx][rx] applied when matrix[tx][rx] = true.
    /// 0.0 = unity (default), negative = attenuate, positive = boost.
    #[serde(default)]
    pub matrix_gain_db: Vec<Vec<f32>>,
    /// Per-zone mute state (true = muted/silent)
    #[serde(default)]
    pub output_muted: Vec<bool>,
    /// Per-output 3-band parametric EQ (len == tx_channels)
    #[serde(default)]
    pub per_output_eq: Vec<EqConfig>,
    /// Per-output brick-wall limiter (len == tx_channels)
    #[serde(default)]
    pub per_output_limiter: Vec<LimiterConfig>,
    /// Per-input DSP chain (len == rx_channels) — supersedes input_gain_db
    #[serde(default)]
    pub input_dsp: Vec<InputChannelDsp>,
    /// Per-output DSP chain (len == tx_channels) — supersedes output_gain_db, output_muted, per_output_eq, per_output_limiter
    #[serde(default)]
    pub output_dsp: Vec<OutputChannelDsp>,
    /// Dante device name as seen on the network
    pub dante_name: String,
    /// Network interface for Dante
    pub dante_nic: String,
    /// Path to statime PTP clock socket (default: /tmp/ptp-usrvclock)
    #[serde(default = "default_clock_path")]
    pub dante_clock_path: String,
    /// Zone groupings with id, name, colour_index, tx_ids.
    /// Auto-derived from tx_channels / zones in normalize() if empty.
    #[serde(default)]
    pub zone_config: Vec<ZoneConfig>,
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
    /// Gain ramp time in ms for zipper-free transitions. Default 10ms.
    #[serde(default = "default_gain_ramp_ms")]
    pub gain_ramp_ms: f32,
    /// Internal submix buses
    #[serde(default)]
    pub internal_buses: Vec<InternalBusConfig>,
    /// Show buses as faders in the mixer view
    #[serde(default = "default_true")]
    pub show_buses_in_mixer: bool,
    /// Bus→TX routing: bus_matrix[tx_idx][bus_idx] = true
    #[serde(default)]
    pub bus_matrix: Option<Vec<Vec<bool>>>,
    /// ALSA device for PFL monitor output. None = solo disabled.
    #[serde(default)]
    pub monitor_device: Option<String>,
    /// Monitor volume in dB, -60 to +12.
    #[serde(default)]
    pub monitor_volume_db: f32,
    /// Optional path to statime observation Unix socket for real PTP offset reporting.
    /// When set and the socket is reachable, health endpoint returns actual offset_ns.
    /// Example: /run/statime/observation.sock
    #[serde(default)]
    pub statime_observation_path: Option<String>,
    /// Soloed RX channel indices. Session-only, NOT persisted.
    #[serde(skip)]
    pub solo_channels: Vec<usize>,
    /// Scene crossfade time in ms (0 = instant)
    #[serde(default)]
    pub scene_crossfade_ms: f32,
    /// Session-only: temporarily overrides xp ramp speed during crossfade
    #[serde(skip)]
    pub xp_ramp_ms: f32,
    /// VCA groups
    #[serde(default)]
    pub vca_groups: Vec<VcaGroupConfig>,
    /// Stereo linked input pairs
    #[serde(default)]
    pub stereo_links: Vec<StereoLinkConfig>,
    /// Built-in signal generators
    #[serde(default)]
    pub signal_generators: Vec<SignalGeneratorConfig>,
    /// generator_bus_matrix[gen_idx][tx_idx] = gain_db (f32::NEG_INFINITY = not routed)
    #[serde(default)]
    pub generator_bus_matrix: Vec<Vec<f32>>,
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
            matrix_gain_db: vec![vec![0.0; rx]; tx],
            output_muted: vec![false; tx],
            per_output_eq: vec![EqConfig::default(); tx],
            per_output_limiter: vec![LimiterConfig::default(); tx],
            input_dsp: (0..rx).map(|_| InputChannelDsp::default()).collect(),
            output_dsp: (0..tx).map(|_| OutputChannelDsp::default()).collect(),
            zone_config: vec![],
            dante_name: "patchbox".to_string(),
            dante_nic: "eth0".to_string(),
            dante_clock_path: default_clock_path(),
            port: 9191,
            rx_jitter_samples: default_rx_jitter_samples(),
            lead_samples: default_lead_samples(),
            gain_ramp_ms: default_gain_ramp_ms(),
            internal_buses: vec![],
            show_buses_in_mixer: true,
            bus_matrix: None,
            monitor_device: None,
            monitor_volume_db: 0.0,
            statime_observation_path: None,
            solo_channels: vec![],
            scene_crossfade_ms: 0.0,
            xp_ramp_ms: 0.0,
            vca_groups: vec![],
            stereo_links: vec![],
            signal_generators: vec![],
            generator_bus_matrix: vec![],
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
        self.matrix_gain_db.resize(self.tx_channels, vec![0.0; self.rx_channels]);
        for row in &mut self.matrix_gain_db {
            row.resize(self.rx_channels, 0.0);
        }

        // Migrate legacy fields into new DSP structs if input_dsp/output_dsp are missing/short
        if self.input_dsp.len() < self.rx_channels {
            self.input_dsp.resize_with(self.rx_channels, InputChannelDsp::default);
            for (i, dsp) in self.input_dsp.iter_mut().enumerate() {
                if let Some(&g) = self.input_gain_db.get(i) {
                    if g != 0.0 { dsp.gain_db = g; }
                }
            }
        }
        if self.output_dsp.len() < self.tx_channels {
            self.output_dsp.resize_with(self.tx_channels, OutputChannelDsp::default);
            for (i, dsp) in self.output_dsp.iter_mut().enumerate() {
                if let Some(&g) = self.output_gain_db.get(i) {
                    if g != 0.0 { dsp.gain_db = g; }
                }
                if let Some(&m) = self.output_muted.get(i) {
                    dsp.muted = m;
                }
                if let Some(eq) = self.per_output_eq.get(i) {
                    dsp.eq.enabled = eq.enabled;
                    for (j, b) in eq.bands[..3.min(eq.bands.len())].iter().enumerate() {
                        dsp.eq.bands[j + 1] = EqBand {
                            freq_hz: b.freq_hz,
                            gain_db: b.gain_db,
                            q: b.q,
                            band_type: EqBandType::Peaking,
                        };
                    }
                }
                if let Some(lim) = self.per_output_limiter.get(i) {
                    dsp.limiter = lim.clone();
                }
            }
        }

        // Auto-derive zone_config from legacy zones vec if not yet persisted
        if self.zone_config.is_empty() {
            self.zone_config = (0..self.tx_channels)
                .map(|tx| ZoneConfig {
                    id: format!("zone_{}", tx),
                    name: self.zones.get(tx).cloned().unwrap_or_else(|| format!("Zone {}", tx + 1)),
                    colour_index: (tx % 10) as u8,
                    tx_ids: vec![format!("tx_{}", tx)],
                })
                .collect();
        }
        // Normalize internal buses
        for bus in &mut self.internal_buses {
            bus.routing.resize(self.rx_channels, false);
            bus.routing_gain.resize(self.rx_channels, 0.0);
        }

        // Resize bus_matrix: [tx_channels][n_buses]
        let n_buses = self.internal_buses.len();
        if n_buses > 0 {
            let bm = self.bus_matrix.get_or_insert_with(Vec::new);
            bm.resize(self.tx_channels, vec![false; n_buses]);
            for row in bm.iter_mut() {
                row.resize(n_buses, false);
            }
        }

        self.monitor_volume_db = self.monitor_volume_db.clamp(-60.0, 12.0);

        // Normalize generator_bus_matrix: [n_gens][tx_channels]
        let n_gens = self.signal_generators.len();
        self.generator_bus_matrix.resize(n_gens, vec![f32::NEG_INFINITY; self.tx_channels]);
        for row in &mut self.generator_bus_matrix {
            row.resize(self.tx_channels, f32::NEG_INFINITY);
        }
    }

    /// Semantic validation after normalize(). Returns first error found.
    pub fn validate(&self) -> Result<(), String> {
        if self.rx_channels == 0 || self.rx_channels > 64 {
            return Err(format!("rx_channels {} out of range [1, 64]", self.rx_channels));
        }
        if self.tx_channels == 0 || self.tx_channels > 64 {
            return Err(format!("tx_channels {} out of range [1, 64]", self.tx_channels));
        }
        if self.matrix.len() != self.tx_channels {
            return Err(format!(
                "matrix has {} rows but tx_channels = {}", self.matrix.len(), self.tx_channels
            ));
        }
        for (tx, row) in self.matrix.iter().enumerate() {
            if row.len() != self.rx_channels {
                return Err(format!(
                    "matrix[{tx}] has {} cols but rx_channels = {}", row.len(), self.rx_channels
                ));
            }
        }
        for (i, g) in self.input_gain_db.iter().enumerate() {
            if !g.is_finite() {
                return Err(format!("input_gain_db[{i}] = {g} is not finite"));
            }
        }
        for (i, g) in self.output_gain_db.iter().enumerate() {
            if !g.is_finite() {
                return Err(format!("output_gain_db[{i}] = {g} is not finite"));
            }
        }
        if self.port == 0 {
            return Err("port must be > 0".into());
        }
        Ok(())
    }
}

fn default_channel_enabled() -> bool { true }

fn default_true() -> bool { true }

fn default_clock_path() -> String {
    "/tmp/ptp-usrvclock".to_string()
}

fn default_rx_jitter_samples() -> usize {
    48
}

fn default_lead_samples() -> usize {
    48
}

fn default_gain_ramp_ms() -> f32 {
    10.0
}
