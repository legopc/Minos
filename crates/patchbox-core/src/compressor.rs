//! D-06: Peak compressor/limiter per output bus.
//!
//! Implements a feedforward peak compressor with attack/release envelope
//! following. Parameters are serialised into `BusParams`. Runtime state
//! (`CompressorState`) is held separately (not serialised).
//!
//! The compressor becomes a hard limiter when `ratio >= 20.0`.

use serde::{Deserialize, Serialize};

/// Compressor/limiter parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressorParams {
    /// Threshold in dBFS (−60 to 0). Default −12 dBFS.
    pub threshold_db:   f32,
    /// Compression ratio (1.0 = bypass, 20.0 = limiter). Default 4.0.
    pub ratio:          f32,
    /// Attack time constant in ms (0.1–200). Default 10 ms.
    pub attack_ms:      f32,
    /// Release time constant in ms (1–2000). Default 100 ms.
    pub release_ms:     f32,
    /// Make-up gain in dB (0–+24). Default 0 dB.
    pub makeup_gain_db: f32,
    pub enabled:        bool,
}

impl Default for CompressorParams {
    fn default() -> Self {
        CompressorParams {
            threshold_db:   -12.0,
            ratio:           4.0,
            attack_ms:      10.0,
            release_ms:    100.0,
            makeup_gain_db:  0.0,
            enabled:        false,
        }
    }
}

/// Runtime compressor state. Holds the envelope follower accumulator.
pub struct CompressorState {
    /// Peak envelope estimate (linear, 0..∞).
    env: f32,
}

impl CompressorState {
    pub fn new() -> Self {
        CompressorState { env: 0.0 }
    }

    /// Apply compression to a block of samples in-place.
    /// No-op when `params.enabled` is false.
    pub fn process_block(
        &mut self,
        params: &CompressorParams,
        buf: &mut [f32],
        sample_rate: f32,
    ) {
        if !params.enabled {
            return;
        }

        let threshold  = 10.0_f32.powf(params.threshold_db   / 20.0);
        let makeup     = 10.0_f32.powf(params.makeup_gain_db / 20.0);
        // Time constants: α = exp(−1 / (τ * Fs))
        let attack_coeff  = (-1.0_f32 / (params.attack_ms  * 0.001 * sample_rate)).exp();
        let release_coeff = (-1.0_f32 / (params.release_ms * 0.001 * sample_rate)).exp();
        let ratio = params.ratio.clamp(1.0, 1000.0);

        for s in buf.iter_mut() {
            let abs_s = s.abs();

            // Peak envelope follower (asymmetric attack/release).
            let coeff = if abs_s > self.env { attack_coeff } else { release_coeff };
            self.env = coeff * self.env + (1.0 - coeff) * abs_s;

            // Gain computation in log domain.
            let gain = if self.env > threshold && self.env > 1e-30 {
                let env_db = 20.0 * self.env.log10();
                let thr_db = params.threshold_db;
                // Output level = threshold + (env − threshold) / ratio
                let out_db = thr_db + (env_db - thr_db) / ratio;
                10.0_f32.powf((out_db - env_db) / 20.0)
            } else {
                1.0
            };

            *s = *s * gain * makeup;
        }
    }
}

impl Default for CompressorState {
    fn default() -> Self {
        CompressorState::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_compressor_passes_through() {
        let params = CompressorParams::default(); // disabled
        let mut state = CompressorState::new();
        let mut buf = vec![0.5_f32; 64];
        state.process_block(&params, &mut buf, 48000.0);
        for s in &buf {
            assert!((s - 0.5).abs() < 1e-6);
        }
    }

    #[test]
    fn enabled_compressor_reduces_loud_signal() {
        let params = CompressorParams {
            enabled: true,
            threshold_db: -6.0,
            ratio: 4.0,
            attack_ms: 1.0,
            release_ms: 100.0,
            makeup_gain_db: 0.0,
        };
        let mut state = CompressorState::new();
        // Feed 0 dBFS sine for long enough for envelope to settle.
        let mut buf = vec![1.0_f32; 4800];
        state.process_block(&params, &mut buf, 48000.0);
        // After envelope settles, output should be below input.
        let last = buf[4799].abs();
        assert!(last < 0.9, "compressor should reduce a loud signal, got {}", last);
    }

    #[test]
    fn compressor_output_finite() {
        let params = CompressorParams { enabled: true, ..Default::default() };
        let mut state = CompressorState::new();
        let mut buf: Vec<f32> = (0..48000).map(|i| ((i as f32 * 0.1).sin())).collect();
        state.process_block(&params, &mut buf, 48000.0);
        for s in &buf {
            assert!(s.is_finite(), "compressor output must be finite");
        }
    }
}
