//! RT-safe brick-wall peak limiter.
//! No allocations, no locks — safe to call from the audio callback.

use crate::config::LimiterConfig;

/// Brick-wall peak limiter with attack/release envelope follower.
/// RT-safe: no allocation, no locks.
pub struct BrickWallLimiter {
    /// Current gain reduction factor (linear, 0..1 — 1 = no reduction).
    gain_reduction: f32,
    /// Attack coefficient (per sample, derived from attack_ms).
    attack_coeff: f32,
    /// Release coefficient (per sample, derived from release_ms).
    release_coeff: f32,
    /// Linear threshold level.
    threshold_linear: f32,
    /// Whether limiter is enabled.
    enabled: bool,
    /// Shadow of last config for change detection.
    last_threshold_db: f32,
    last_attack_ms: f32,
    last_release_ms: f32,
    last_enabled: bool,
}

impl BrickWallLimiter {
    pub fn new() -> Self {
        let mut s = Self {
            gain_reduction: 1.0,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            threshold_linear: 1.0,
            enabled: false,
            last_threshold_db: f32::NAN,
            last_attack_ms: f32::NAN,
            last_release_ms: f32::NAN,
            last_enabled: false,
        };
        // Apply default config to set initial coefficients
        let default = LimiterConfig::default();
        s.update_coeffs(&default, 48_000.0);
        s
    }

    fn update_coeffs(&mut self, cfg: &LimiterConfig, sample_rate: f32) {
        self.threshold_linear = 10.0_f32.powf(cfg.threshold_db / 20.0);
        self.enabled = cfg.enabled;
        // Time constant → per-sample coefficient using exponential decay
        // coeff = exp(-1 / (time_ms * 0.001 * sample_rate))
        let attack_secs = (cfg.attack_ms * 0.001).max(1e-6);
        let release_secs = (cfg.release_ms * 0.001).max(1e-6);
        self.attack_coeff = (-1.0 / (attack_secs * sample_rate)).exp();
        self.release_coeff = (-1.0 / (release_secs * sample_rate)).exp();

        self.last_threshold_db = cfg.threshold_db;
        self.last_attack_ms = cfg.attack_ms;
        self.last_release_ms = cfg.release_ms;
        self.last_enabled = cfg.enabled;
    }

    /// Sync coefficients from config if changed. RT-safe: pure arithmetic.
    pub fn sync(&mut self, cfg: &LimiterConfig, sample_rate: f32) {
        let changed = cfg.enabled != self.last_enabled
            || (cfg.threshold_db - self.last_threshold_db).abs() > 0.001
            || (cfg.attack_ms - self.last_attack_ms).abs() > 0.001
            || (cfg.release_ms - self.last_release_ms).abs() > 0.001;
        if changed {
            self.update_coeffs(cfg, sample_rate);
            if !cfg.enabled {
                self.gain_reduction = 1.0; // reset when disabling
            }
        }
    }

    /// Process a block in-place. Returns the minimum gain_reduction seen this block (for metering).
    /// RT-safe.
    pub fn process_block(&mut self, buf: &mut [f32]) -> f32 {
        if !self.enabled {
            return 1.0;
        }
        let mut min_gr = 1.0f32;
        for s in buf.iter_mut() {
            let peak = s.abs();
            // Compute desired gain reduction: if peak > threshold, clamp it
            let desired_gr = if peak > self.threshold_linear {
                self.threshold_linear / peak
            } else {
                1.0
            };
            // Envelope follower: attack when GR decreasing, release when increasing
            self.gain_reduction = if desired_gr < self.gain_reduction {
                // Attack: fast gain reduction
                self.attack_coeff * self.gain_reduction + (1.0 - self.attack_coeff) * desired_gr
            } else {
                // Release: slow gain recovery
                self.release_coeff * self.gain_reduction + (1.0 - self.release_coeff) * desired_gr
            };
            // Hard brick-wall: never exceed threshold regardless of envelope lag
            *s = (*s * self.gain_reduction).clamp(-self.threshold_linear, self.threshold_linear);
            if self.gain_reduction < min_gr {
                min_gr = self.gain_reduction;
            }
        }
        min_gr
    }

    /// Current gain reduction in dB (0 = no reduction, negative = limiting active).
    pub fn gain_reduction_db(&self) -> f32 {
        if self.gain_reduction <= 0.0 {
            -120.0
        } else {
            20.0 * self.gain_reduction.log10()
        }
    }
}

impl Default for BrickWallLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::LimiterConfig;

    fn cfg(threshold_db: f32, enabled: bool) -> LimiterConfig {
        LimiterConfig {
            threshold_db,
            attack_ms: 0.1,
            release_ms: 50.0,
            enabled,
        }
    }

    #[test]
    fn disabled_limiter_passes_signal_unchanged() {
        let mut lim = BrickWallLimiter::new();
        lim.sync(&cfg(-3.0, false), 48_000.0);
        let input = vec![0.9f32; 64];
        let mut buf = input.clone();
        lim.process_block(&mut buf);
        for (a, b) in input.iter().zip(buf.iter()) {
            assert!((a - b).abs() < 1e-6, "disabled limiter must pass unchanged");
        }
    }

    #[test]
    fn signal_below_threshold_passes_unchanged() {
        let mut lim = BrickWallLimiter::new();
        lim.sync(&cfg(-3.0, true), 48_000.0);
        // -3dBFS threshold ≈ 0.708 linear; signal at 0.5 is well below
        let input = vec![0.5f32; 256];
        let mut buf = input.clone();
        lim.process_block(&mut buf);
        // After envelope settles, signal below threshold passes through
        for s in &buf[200..] {
            assert!(*s > 0.49, "signal below threshold should pass: {s}");
        }
    }

    #[test]
    fn signal_above_threshold_is_limited() {
        let mut lim = BrickWallLimiter::new();
        // -6dBFS threshold ≈ 0.5 linear
        let threshold_linear = 10.0_f32.powf(-6.0 / 20.0);
        lim.sync(&cfg(-6.0, true), 48_000.0);
        // Drive with 0dBFS signal (1.0) — should be limited
        let mut buf = vec![1.0f32; 512];
        lim.process_block(&mut buf);
        // After attack settles, output should be at or below threshold
        for s in &buf[400..] {
            assert!(
                s.abs() <= threshold_linear + 1e-5,
                "output must not exceed threshold: {s} > {threshold_linear}"
            );
        }
    }

    #[test]
    fn gain_reduction_db_returns_non_positive() {
        let mut lim = BrickWallLimiter::new();
        lim.sync(&cfg(-6.0, true), 48_000.0);
        let mut buf = vec![1.0f32; 512];
        lim.process_block(&mut buf);
        assert!(
            lim.gain_reduction_db() <= 0.0,
            "GR must be <= 0dB when limiting"
        );
    }
}
