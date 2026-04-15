//! Shared meter state — linear RMS per channel.

/// Live RMS levels and gain-reduction for all channels (linear 0..1 / dB).
#[derive(Default, Clone)]
pub struct MeterState {
    /// Per-RX (input) channel linear RMS
    pub rx_rms: Vec<f32>,
    /// Per-TX (output) channel linear RMS
    pub tx_rms: Vec<f32>,
    /// Per-RX peak hold linear (decay 10dB/s, updated by matrix.rs)
    pub rx_peak: Vec<f32>,
    /// Per-TX peak hold linear
    pub tx_peak: Vec<f32>,
    /// Per-RX gate+compressor gain reduction in dB (0 = no reduction, negative = active)
    pub rx_gr_db: Vec<f32>,
    /// Per-TX limiter+compressor gain reduction in dB (0 = no reduction, negative = active)
    pub tx_gr_db: Vec<f32>,
    /// Per-RX gate open state
    pub rx_gate_open: Vec<bool>,
    /// Per-bus linear RMS
    pub bus_rms: Vec<f32>,
    /// Per-RX cumulative clip count (sample > 0.999)
    pub rx_clip_count: Vec<u64>,
    /// Per-TX cumulative clip count (sample > 0.999)
    pub tx_clip_count: Vec<u64>,
    /// Deprecated: kept for backward compat, same as tx_gr_db
    #[deprecated = "use tx_gr_db instead"]
    pub gr_db: Vec<f32>,
}

impl MeterState {
    pub fn new(rx: usize, tx: usize) -> Self {
        Self {
            rx_rms: vec![0.0; rx],
            tx_rms: vec![0.0; tx],
            rx_peak: vec![0.0; rx],
            tx_peak: vec![0.0; tx],
            rx_gr_db: vec![0.0; rx],
            tx_gr_db: vec![0.0; tx],
            rx_gate_open: vec![false; rx],
            bus_rms: vec![],
            rx_clip_count: vec![0; rx],
            tx_clip_count: vec![0; tx],
            gr_db: vec![0.0; tx],
        }
    }
}
