//! RT-safe feed-forward RMS compressor with soft knee.
//! No allocations, no locks — safe to call from the audio callback.

use crate::config::CompressorConfig;

/// Feed-forward RMS compressor with soft knee and makeup gain.
/// RT-safe: no allocation, no locks.
pub struct Compressor {
    /// Running RMS² via 1st-order IIR (fixed 10ms window).
    rms_squared: f32,
    /// IIR coefficient for RMS (fixed 10ms window at any sample rate).
    rms_coeff: f32,
    /// Current smoothed gain (linear, 1.0 = no gain reduction).
    current_gain: f32,
    /// Attack coefficient (per sample, derived from attack_ms).
    attack_coeff: f32,
    /// Release coefficient (per sample, derived from release_ms).
    release_coeff: f32,
    /// Threshold in dB.
    threshold_db: f32,
    /// Compression ratio.
    ratio: f32,
    /// Soft knee half-width in dB.
    knee_db: f32,
    /// Makeup gain (linear).
    makeup_linear: f32,
    /// Whether compressor is enabled.
    enabled: bool,
    /// Shadow config for change detection.
    last_threshold_db: f32,
    last_ratio: f32,
    last_knee_db: f32,
    last_attack_ms: f32,
    last_release_ms: f32,
    last_makeup_db: f32,
    last_enabled: bool,
}

impl Compressor {
    pub fn new() -> Self {
        let mut s = Self {
            rms_squared: 0.0,
            rms_coeff: 0.0,
            current_gain: 1.0,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            threshold_db: -18.0,
            ratio: 4.0,
            knee_db: 6.0,
            makeup_linear: 1.0,
            enabled: false,
            last_threshold_db: f32::NAN,
            last_ratio: f32::NAN,
            last_knee_db: f32::NAN,
            last_attack_ms: f32::NAN,
            last_release_ms: f32::NAN,
            last_makeup_db: f32::NAN,
            last_enabled: false,
        };
        let default = CompressorConfig::default();
        s.update_coeffs(&default, 48_000.0);
        s
    }

    fn update_coeffs(&mut self, cfg: &CompressorConfig, sample_rate: f32) {
        self.threshold_db = cfg.threshold_db;
        self.ratio = cfg.ratio.max(1.0);
        self.knee_db = cfg.knee_db.max(0.0);
        self.makeup_linear = 10.0_f32.powf(cfg.makeup_db / 20.0);
        self.enabled = cfg.enabled;

        // RMS coefficient for fixed 10ms window
        // coeff = exp(-1 / (0.01 * sample_rate))
        let rms_time_secs = 0.01;
        self.rms_coeff = (-1.0 / (rms_time_secs * sample_rate)).exp();

        // Time constant → per-sample coefficient using exponential decay
        // coeff = exp(-1 / (time_ms * 0.001 * sample_rate))
        let attack_secs = (cfg.attack_ms * 0.001).max(1e-6);
        let release_secs = (cfg.release_ms * 0.001).max(1e-6);
        self.attack_coeff = (-1.0 / (attack_secs * sample_rate)).exp();
        self.release_coeff = (-1.0 / (release_secs * sample_rate)).exp();

        self.last_threshold_db = cfg.threshold_db;
        self.last_ratio = cfg.ratio;
        self.last_knee_db = cfg.knee_db;
        self.last_attack_ms = cfg.attack_ms;
        self.last_release_ms = cfg.release_ms;
        self.last_makeup_db = cfg.makeup_db;
        self.last_enabled = cfg.enabled;
    }

    /// Sync coefficients from config if changed. RT-safe: pure arithmetic.
    pub fn sync(&mut self, cfg: &CompressorConfig, sample_rate: f32) {
        let changed = cfg.enabled != self.last_enabled
            || (cfg.threshold_db - self.last_threshold_db).abs() > 0.001
            || (cfg.ratio - self.last_ratio).abs() > 0.001
            || (cfg.knee_db - self.last_knee_db).abs() > 0.001
            || (cfg.attack_ms - self.last_attack_ms).abs() > 0.001
            || (cfg.release_ms - self.last_release_ms).abs() > 0.001
            || (cfg.makeup_db - self.last_makeup_db).abs() > 0.001;
        if changed {
            self.update_coeffs(cfg, sample_rate);
            if !cfg.enabled {
                self.current_gain = 1.0;
                self.rms_squared = 0.0;
            }
        }
    }

    /// Process a block in-place. Returns the minimum gain (linear) seen this block (for metering).
    /// RT-safe.
    pub fn process_block(&mut self, buf: &mut [f32]) -> f32 {
        if !self.enabled {
            return 1.0;
        }

        let mut min_gain = 1.0f32;

        for s in buf.iter_mut() {
            let sample = *s;

            // 1. RMS level detection (10ms window via 1st-order IIR)
            let sample_sq = sample * sample;
            self.rms_squared =
                self.rms_coeff * self.rms_squared + (1.0 - self.rms_coeff) * sample_sq;
            let rms = self.rms_squared.sqrt();

            // 2. Convert RMS to dB (floor at -120 dB to avoid -inf)
            let input_db = if rms > 1e-6 {
                20.0 * rms.log10()
            } else {
                -120.0
            };

            // 3. Soft knee gain computation
            let gain_db = self.compute_gain_db(input_db);

            // 4. Envelope smoothing (attack/release)
            let target_gain_linear = 10.0_f32.powf(gain_db / 20.0);
            if target_gain_linear < self.current_gain {
                // Attack: fast reduction
                self.current_gain = self.attack_coeff * self.current_gain
                    + (1.0 - self.attack_coeff) * target_gain_linear;
            } else {
                // Release: slow recovery
                self.current_gain = self.release_coeff * self.current_gain
                    + (1.0 - self.release_coeff) * target_gain_linear;
            }

            // 5. Apply gain + makeup
            *s = sample * self.current_gain * self.makeup_linear;

            if self.current_gain < min_gain {
                min_gain = self.current_gain;
            }
        }

        min_gain
    }

    /// Compute gain reduction in dB for a given input level (dB).
    /// Implements soft knee with quadratic interpolation.
    fn compute_gain_db(&self, input_db: f32) -> f32 {
        let offset = input_db - self.threshold_db;
        let knee_half = self.knee_db / 2.0;

        let output_db = if offset < -knee_half {
            // Below knee: no compression
            input_db
        } else if offset > knee_half {
            // Above knee: full compression
            self.threshold_db + offset / self.ratio
        } else {
            // Inside knee: quadratic interpolation
            let x = offset + knee_half;
            input_db + (1.0 / self.ratio - 1.0) * x * x / (2.0 * self.knee_db)
        };

        output_db - input_db
    }

    /// Current gain reduction in dB (0 = no reduction, negative = compression active).
    pub fn gain_reduction_db(&self) -> f32 {
        if self.current_gain <= 0.0 {
            -120.0
        } else {
            20.0 * self.current_gain.log10()
        }
    }
}

impl Default for Compressor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(threshold_db: f32, ratio: f32, knee_db: f32, attack_ms: f32, release_ms: f32,
           makeup_db: f32, enabled: bool) -> CompressorConfig {
        CompressorConfig { enabled, threshold_db, ratio, knee_db, attack_ms,
                           release_ms, makeup_db }
    }

    #[test]
    fn disabled_compressor_passes_unchanged() {
        let mut comp = Compressor::new();
        comp.sync(&cfg(-18.0, 4.0, 6.0, 10.0, 100.0, 0.0, false), 48_000.0);
        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        comp.process_block(&mut buf);
        for (a, b) in input.iter().zip(buf.iter()) {
            assert!((a - b).abs() < 1e-6, "disabled compressor must pass unchanged");
        }
    }

    #[test]
    fn signal_below_threshold_passes_unchanged() {
        let mut comp = Compressor::new();
        // -18dB threshold ≈ 0.126 linear; signal at 0.05 is well below
        comp.sync(&cfg(-18.0, 4.0, 6.0, 10.0, 100.0, 0.0, true), 48_000.0);
        let input = vec![0.05f32; 256];
        let mut buf = input.clone();
        comp.process_block(&mut buf);
        // After envelope settles, signal below threshold should pass with minimal change
        for s in &buf[200..] {
            assert!((*s - 0.05).abs() < 0.01, "signal below threshold should pass: {s}");
        }
    }

    #[test]
    fn signal_above_threshold_is_compressed() {
        let mut comp = Compressor::new();
        // -18dBFS threshold ≈ 0.126 linear
        // 4:1 ratio, knife 6dB
        // Drive with 0dBFS signal (1.0) — much above threshold
        comp.sync(&cfg(-18.0, 4.0, 6.0, 10.0, 100.0, 0.0, true), 48_000.0);
        // Process in longer block: 100ms release time at 48kHz = 4800 samples
        let mut buf = vec![1.0f32; 6000];
        comp.process_block(&mut buf);
        // After settling (last ~1000 samples should be near convergence)
        let settled = &buf[5000..];
        for s in settled {
            assert!(*s < 0.3, "signal above threshold should be compressed: {s}");
        }
    }

    #[test]
    fn makeup_gain_is_applied() {
        let mut comp = Compressor::new();
        // Small signal below threshold with +6dB makeup
        comp.sync(&cfg(-18.0, 4.0, 6.0, 10.0, 100.0, 6.0, true), 48_000.0);
        let input = vec![0.05f32; 256];
        let mut buf = input.clone();
        comp.process_block(&mut buf);
        // After settling, with makeup gain, signal should be boosted
        // 0.05 * 10^(6/20) ≈ 0.05 * 1.995 ≈ 0.1
        let expected_gain_linear = 10.0_f32.powf(6.0 / 20.0);
        for s in &buf[200..] {
            let expected = input[0] * expected_gain_linear;
            assert!((s - expected).abs() < 0.01,
                    "makeup gain should boost output: {s} vs {expected}");
        }
    }

    #[test]
    fn gain_reduction_db_returns_non_positive_when_compressing() {
        let mut comp = Compressor::new();
        // -6dB threshold, 4:1 ratio
        comp.sync(&cfg(-6.0, 4.0, 6.0, 10.0, 100.0, 0.0, true), 48_000.0);
        // Drive with 0dBFS signal (1.0)
        let mut buf = vec![1.0f32; 512];
        comp.process_block(&mut buf);
        let gr_db = comp.gain_reduction_db();
        assert!(gr_db <= 0.0, "GR must be <= 0dB when compressing, got {gr_db}");
        assert!(gr_db > -120.0, "GR should not be at floor for visible compression");
    }

    #[test]
    fn soft_knee_interpolation_is_smooth() {
        let mut comp = Compressor::new();
        // Test that gain changes smoothly through the knee region
        comp.sync(&cfg(-20.0, 4.0, 8.0, 1.0, 10.0, 0.0, true), 48_000.0);

        // Test input just below knee: should have minimal compression
        let gain_below = comp.compute_gain_db(-24.0); // 4dB below threshold
        assert!(gain_below > -0.5, "gain just below knee should be small: {gain_below}");

        // Test input in knee: should have partial compression
        let gain_knee = comp.compute_gain_db(-20.0); // at threshold
        assert!(gain_knee < -0.1 && gain_knee > -1.0, "gain in knee should be partial: {gain_knee}");

        // Test input above knee: should have full 4:1 compression
        // -12dB input, -20dB threshold, 4:1 ratio: output = -20 + (-12 - (-20))/4 = -20 + 8/4 = -18
        // gain = -18 - (-12) = -6dB
        let gain_above = comp.compute_gain_db(-12.0); // 8dB above threshold
        let expected_gain_above = -6.0;
        assert!(
            (gain_above - expected_gain_above).abs() < 0.1,
            "gain above knee should follow 4:1 ratio: {gain_above} vs {expected_gain_above}"
        );
    }
}
