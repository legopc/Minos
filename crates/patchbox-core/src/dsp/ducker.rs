// S7 s7-feat-sidechain-duck — dedicated ducker block.
//
// Ducker is a compressor whose detector signal is a different input/bus (key).
// Typical use: paging mic ducks background music.
// Wire: add `ducker: Option<Ducker>` to PerOutputDsp; call process_block with
// the output RMS as `sidechain_rms` when a sidechain_source_id is configured.

use crate::config::DuckerConfig;

pub struct Ducker {
    config: DuckerConfig,
    /// Smoothed sidechain envelope level (linear).
    envelope: f32,
    /// Current gain reduction in dB (≤ 0).
    gain_db: f32,
    attack_coef: f32,
    release_coef: f32,
}

impl Ducker {
    pub fn new(config: DuckerConfig, sample_rate: f32) -> Self {
        let (attack_coef, release_coef) = Self::compute_coefs(&config, sample_rate);
        Self {
            config,
            envelope: 0.0,
            gain_db: 0.0,
            attack_coef,
            release_coef,
        }
    }

    fn compute_coefs(cfg: &DuckerConfig, sample_rate: f32) -> (f32, f32) {
        let attack_coef = if cfg.attack_ms > 0.0 {
            (-1.0_f32 / (cfg.attack_ms * 0.001 * sample_rate)).exp()
        } else {
            0.0
        };
        let release_coef = if cfg.release_ms > 0.0 {
            (-1.0_f32 / (cfg.release_ms * 0.001 * sample_rate)).exp()
        } else {
            0.0
        };
        (attack_coef, release_coef)
    }

    /// Duck `signal` based on `sidechain_rms` (linear 0..1).
    /// Only processes when `enabled && !bypassed`.
    pub fn process_block(&mut self, signal: &mut [f32], sidechain_rms: f32) {
        if !self.config.enabled || self.config.bypassed {
            self.gain_db = 0.0;
            return;
        }

        // Smooth the sidechain envelope.
        let coef = if sidechain_rms > self.envelope {
            self.attack_coef
        } else {
            self.release_coef
        };
        self.envelope = coef * self.envelope + (1.0 - coef) * sidechain_rms;

        // Compute gain reduction in dB.
        let env_db = if self.envelope > 1e-10 {
            20.0 * self.envelope.log10()
        } else {
            -100.0_f32
        };

        let target_gr = if env_db > self.config.threshold_db {
            let excess = env_db - self.config.threshold_db;
            // Amount to reduce: excess * (1 - 1/ratio), clamped to range_db.
            let reduction = excess * (1.0 - 1.0 / self.config.ratio.max(1.0));
            (-reduction).max(self.config.range_db)
        } else {
            0.0
        };

        self.gain_db = target_gr;

        // Apply gain to signal.
        if self.gain_db < -0.001 {
            let gain_linear = 10.0_f32.powf(self.gain_db / 20.0);
            for s in signal.iter_mut() {
                *s *= gain_linear;
            }
        }
    }

    pub fn update_config(&mut self, config: DuckerConfig, sample_rate: f32) {
        let (ac, rc) = Self::compute_coefs(&config, sample_rate);
        self.config = config;
        self.attack_coef = ac;
        self.release_coef = rc;
    }

    /// Last gain reduction applied (dB, ≤ 0).
    pub fn last_gr_db(&self) -> f32 { self.gain_db }
}
