//! Per-channel DSP strip: gain trim, mute, solo, parametric EQ (D-05),
//! pan/balance (M-02), high-pass filter (M-10).

use crate::eq::EqParams;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StripParams {
    pub label:     String,
    /// Linear gain trim applied before the matrix (0.0–4.0, 1.0 = unity).
    pub gain_trim: f32,
    pub mute:      bool,
    pub solo:      bool,
    /// D-05: 4-band parametric EQ per input strip.
    #[serde(default)]
    pub eq: EqParams,
    /// M-02: Pan/balance position (-1.0 = full left, 0.0 = centre, +1.0 = full right).
    #[serde(default)]
    pub pan: f32,
    /// M-10: High-pass filter — enabled flag.
    #[serde(default)]
    pub hpf_enabled: bool,
    /// M-10: HPF cutoff frequency in Hz (default 80 Hz).
    #[serde(default = "default_hpf_hz")]
    pub hpf_hz: f32,
}

fn default_hpf_hz() -> f32 { 80.0 }

impl Default for StripParams {
    fn default() -> Self {
        Self {
            label:       String::new(),
            gain_trim:   1.0,
            mute:        false,
            solo:        false,
            eq:          EqParams::default(),
            pan:         0.0,
            hpf_enabled: false,
            hpf_hz:      80.0,
        }
    }
}

impl StripParams {
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            ..Default::default()
        }
    }

    /// Effective gain applied to the audio sample.
    /// Returns 0.0 when muted.
    pub fn effective_gain(&self) -> f32 {
        if self.mute { 0.0 } else { self.gain_trim }
    }
}

/// Apply strip processing to a block of samples in-place.
pub fn apply_strip(params: &StripParams, buf: &mut [f32]) {
    let gain = params.effective_gain();
    if gain == 1.0 {
        return;
    }
    for s in buf.iter_mut() {
        *s *= gain;
    }
}
