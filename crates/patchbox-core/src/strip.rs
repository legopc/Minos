//! Per-channel DSP strip: gain trim, mute, solo.
//!
//! Extends to EQ and dynamics in Phase 3.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StripParams {
    pub label:     String,
    /// Linear gain trim applied before the matrix (0.0–4.0, 1.0 = unity).
    pub gain_trim: f32,
    pub mute:      bool,
    pub solo:      bool,
}

impl Default for StripParams {
    fn default() -> Self {
        Self {
            label:     String::new(),
            gain_trim: 1.0,
            mute:      false,
            solo:      false,
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
