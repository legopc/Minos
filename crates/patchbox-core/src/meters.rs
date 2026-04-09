//! Shared meter state — linear RMS per channel.

/// Live RMS levels for all channels (linear 0..1).
#[derive(Default, Clone)]
pub struct MeterState {
    /// Per-RX (input) channel linear RMS
    pub rx_rms: Vec<f32>,
    /// Per-TX (output) channel linear RMS
    pub tx_rms: Vec<f32>,
}

impl MeterState {
    pub fn new(rx: usize, tx: usize) -> Self {
        Self {
            rx_rms: vec![0.0; rx],
            tx_rms: vec![0.0; tx],
        }
    }
}
