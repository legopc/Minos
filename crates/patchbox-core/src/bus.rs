//! Output bus: master gain + mute + compressor/limiter (D-06) applied after the matrix.

use crate::compressor::CompressorParams;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusParams {
    pub label:        String,
    /// Master gain for this output bus (0.0–4.0, 1.0 = unity).
    pub master_gain:  f32,
    pub mute:         bool,
    /// D-06: compressor/limiter per output bus.
    #[serde(default)]
    pub compressor:   CompressorParams,
}

impl Default for BusParams {
    fn default() -> Self {
        Self {
            label:       String::new(),
            master_gain: 1.0,
            mute:        false,
            compressor:  CompressorParams::default(),
        }
    }
}

impl BusParams {
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            master_gain: 1.0,
            mute: false,
            compressor: CompressorParams::default(),
        }
    }

    pub fn effective_gain(&self) -> f32 {
        if self.mute { 0.0 } else { self.master_gain }
    }
}

/// Apply bus master processing to a block of samples in-place.
pub fn apply_bus(params: &BusParams, buf: &mut [f32]) {
    let gain = params.effective_gain();
    if gain == 1.0 {
        return;
    }
    for s in buf.iter_mut() {
        *s *= gain;
    }
}
