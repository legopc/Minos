//! D-05: 4-band parametric EQ per input strip.
//!
//! Implements the standard Audio EQ Cookbook biquad filters:
//!   - Low shelf, Peak/Bell, High shelf
//!
//! Parameters are serialised into `StripParams` (scenes, state API).
//! Runtime filter state (`EqProcessor`) is held separately (not serialised).

use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

/// Which biquad shape to use for a given band.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BandType {
    LowShelf,
    Peak,
    HighShelf,
}

impl Default for BandType {
    fn default() -> Self {
        BandType::Peak
    }
}

/// Parameters for one EQ band.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqBand {
    pub band_type: BandType,
    /// Shelf/centre frequency in Hz (20–20 000).
    pub freq_hz:   f32,
    /// Boost/cut in dB (−18 to +18).
    pub gain_db:   f32,
    /// Quality factor (0.1–10.0). Bandwidth for peak; slope for shelves.
    pub q:         f32,
    pub enabled:   bool,
}

impl Default for EqBand {
    fn default() -> Self {
        EqBand {
            band_type: BandType::Peak,
            freq_hz:   1000.0,
            gain_db:   0.0,
            q:         1.0,
            enabled:   false,
        }
    }
}

/// Normalised biquad coefficients (divided by a0).
/// Transfer function: H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
#[derive(Debug, Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoeffs {
    /// Pass-through identity filter.
    pub fn identity() -> Self {
        BiquadCoeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 }
    }

    /// Compute biquad coefficients from a band description.
    /// Based on Robert Bristow-Johnson's Audio EQ Cookbook.
    pub fn from_band(band: &EqBand, sample_rate: f32) -> Self {
        let freq = band.freq_hz.clamp(20.0, sample_rate * 0.499);
        let q    = band.q.clamp(0.1, 10.0);
        let w0   = 2.0 * PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        // A = sqrt(10^(dB/20)) — shelves use sqrt(A), peaks use A.
        let a      = 10.0_f32.powf(band.gain_db / 40.0);
        let alpha  = sin_w0 / (2.0 * q);

        let (b0, b1, b2, a0, a1, a2) = match band.band_type {
            BandType::Peak => (
                1.0 + alpha * a,
                -2.0 * cos_w0,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos_w0,
                1.0 - alpha / a,
            ),
            BandType::LowShelf => {
                let sa = a.sqrt();
                (
                      a * ((a + 1.0) - (a - 1.0)*cos_w0 + 2.0*sa*alpha),
                  2.0*a * ((a - 1.0) - (a + 1.0)*cos_w0),
                      a * ((a + 1.0) - (a - 1.0)*cos_w0 - 2.0*sa*alpha),
                         (a + 1.0) + (a - 1.0)*cos_w0 + 2.0*sa*alpha,
                    -2.0*((a - 1.0) + (a + 1.0)*cos_w0),
                         (a + 1.0) + (a - 1.0)*cos_w0 - 2.0*sa*alpha,
                )
            }
            BandType::HighShelf => {
                let sa = a.sqrt();
                (
                      a * ((a + 1.0) + (a - 1.0)*cos_w0 + 2.0*sa*alpha),
                 -2.0*a * ((a - 1.0) + (a + 1.0)*cos_w0),
                      a * ((a + 1.0) + (a - 1.0)*cos_w0 - 2.0*sa*alpha),
                         (a + 1.0) - (a - 1.0)*cos_w0 + 2.0*sa*alpha,
                     2.0*((a - 1.0) - (a + 1.0)*cos_w0),
                         (a + 1.0) - (a - 1.0)*cos_w0 - 2.0*sa*alpha,
                )
            }
        };

        BiquadCoeffs {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

/// Per-band filter memory (z^-1, z^-2 state). Not serialised.
#[derive(Debug, Clone, Default)]
pub struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadState {
    /// Process one sample through the biquad.
    #[inline]
    pub fn process(&mut self, c: &BiquadCoeffs, x: f32) -> f32 {
        let y = c.b0*x + c.b1*self.x1 + c.b2*self.x2
                       - c.a1*self.y1 - c.a2*self.y2;
        self.x2 = self.x1; self.x1 = x;
        self.y2 = self.y1; self.y1 = y;
        y
    }

    pub fn reset(&mut self) { *self = BiquadState::default(); }
}

/// 4-band parametric EQ: low shelf | peak | peak | high shelf.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqParams {
    pub bands:   [EqBand; 4],
    pub enabled: bool,
}

impl Default for EqParams {
    fn default() -> Self {
        EqParams {
            bands: [
                EqBand { band_type: BandType::LowShelf,  freq_hz:   100.0, gain_db: 0.0, q: 0.707, enabled: false },
                EqBand { band_type: BandType::Peak,       freq_hz:   500.0, gain_db: 0.0, q: 1.0,   enabled: false },
                EqBand { band_type: BandType::Peak,       freq_hz:  3000.0, gain_db: 0.0, q: 1.0,   enabled: false },
                EqBand { band_type: BandType::HighShelf,  freq_hz: 10000.0, gain_db: 0.0, q: 0.707, enabled: false },
            ],
            enabled: false,
        }
    }
}

/// Runtime EQ processor. Holds filter states and cached coefficients.
/// Create one per input channel; call `update_params` when params change.
pub struct EqProcessor {
    states:      [BiquadState; 4],
    coeffs:      [BiquadCoeffs; 4],
    sample_rate: f32,
}

impl EqProcessor {
    pub fn new(sample_rate: f32) -> Self {
        EqProcessor {
            states:      Default::default(),
            coeffs:      [BiquadCoeffs::identity(); 4],
            sample_rate,
        }
    }

    /// Recompute coefficients from new params. Call when params change.
    pub fn update_params(&mut self, params: &EqParams) {
        for (i, band) in params.bands.iter().enumerate() {
            self.coeffs[i] = if band.enabled {
                BiquadCoeffs::from_band(band, self.sample_rate)
            } else {
                BiquadCoeffs::identity()
            };
        }
    }

    /// Apply EQ to a block of samples in-place. No-op when EQ is disabled.
    pub fn process_block(&mut self, params: &EqParams, buf: &mut [f32]) {
        if !params.enabled { return; }
        for s in buf.iter_mut() {
            let mut y = *s;
            for i in 0..4 {
                y = self.states[i].process(&self.coeffs[i], y);
            }
            *s = y;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_coeffs_pass_through() {
        let c = BiquadCoeffs::identity();
        let mut state = BiquadState::default();
        let y = state.process(&c, 1.0);
        assert!((y - 1.0).abs() < 1e-6, "identity filter should be transparent");
    }

    #[test]
    fn disabled_eq_passes_through() {
        let params = EqParams::default(); // all bands disabled, eq disabled
        let mut proc = EqProcessor::new(48000.0);
        proc.update_params(&params);
        let mut buf = vec![1.0_f32; 64];
        proc.process_block(&params, &mut buf);
        for s in &buf {
            assert!((s - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn peak_band_coefficients_finite() {
        let band = EqBand {
            band_type: BandType::Peak,
            freq_hz: 1000.0,
            gain_db: 6.0,
            q: 1.0,
            enabled: true,
        };
        let c = BiquadCoeffs::from_band(&band, 48000.0);
        assert!(c.b0.is_finite());
        assert!(c.a1.is_finite());
    }
}
