//! RT-safe noise gate / expander with hold timer.
//! No allocations, no locks — safe to call from the audio callback.

use crate::config::GateConfig;

#[derive(Debug, Clone, Copy, PartialEq)]
enum GateState {
    Closed,
    Attack,
    Open,
    Hold,
    Release,
}

/// Downward expander / noise gate with hold timer.
/// RT-safe: no allocation, no locks.
pub struct GateExpander {
    /// Current state machine state.
    state: GateState,
    /// Current gain in linear (0.0 = fully closed, 1.0 = open).
    current_gain: f32,
    /// Simple peak follower (slow decay at 0.9999 alpha).
    peak_follower: f32,
    /// Linear threshold level (converted from dB).
    threshold_linear: f32,
    /// Linear amplitude at max attenuation (range_db converted, stored as positive).
    range_linear: f32,
    /// Attack coefficient (per-sample exponential decay).
    attack_coeff: f32,
    /// Release coefficient (per-sample exponential decay).
    release_coeff: f32,
    /// Total hold time in samples.
    hold_samples_total: usize,
    /// Remaining hold samples counter.
    hold_samples_remaining: usize,
    /// Whether gate is enabled.
    enabled: bool,
    /// Config change detection (enabled, threshold_db, ratio, attack_ms, hold_ms, release_ms, range_db).
    last_cfg_hash: (bool, u32, u32, u32, u32, u32, u32),
}

impl GateExpander {
    pub fn new() -> Self {
        let mut s = Self {
            state: GateState::Closed,
            current_gain: 0.0,
            peak_follower: 0.0,
            threshold_linear: 1.0,
            range_linear: 1e-3,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            hold_samples_total: 0,
            hold_samples_remaining: 0,
            enabled: false,
            last_cfg_hash: (false, 0, 0, 0, 0, 0, 0),
        };
        let default = GateConfig::default();
        s.update_coeffs(&default, 48_000.0);
        s
    }

    fn update_coeffs(&mut self, cfg: &GateConfig, sample_rate: f32) {
        self.threshold_linear = 10.0_f32.powf(cfg.threshold_db / 20.0);
        // range_db is typically negative (e.g. -60), convert to linear amplitude
        self.range_linear = 10.0_f32.powf(cfg.range_db / 20.0);
        self.enabled = cfg.enabled;

        // Time constant → per-sample coefficient using exponential decay
        // coeff = exp(-1 / (time_ms * 0.001 * sample_rate))
        let attack_secs = (cfg.attack_ms * 0.001).max(1e-6);
        let release_secs = (cfg.release_ms * 0.001).max(1e-6);
        self.attack_coeff = (-1.0 / (attack_secs * sample_rate)).exp();
        self.release_coeff = (-1.0 / (release_secs * sample_rate)).exp();

        // Hold time in samples
        self.hold_samples_total = ((cfg.hold_ms * 0.001) * sample_rate).max(0.0) as usize;

        // Build hash for change detection (use bits as proxies for values)
        let th_bits = cfg.threshold_db.to_bits();
        let ra_bits = cfg.ratio.to_bits();
        let at_bits = cfg.attack_ms.to_bits();
        let ho_bits = cfg.hold_ms.to_bits();
        let re_bits = cfg.release_ms.to_bits();
        let rg_bits = cfg.range_db.to_bits();

        self.last_cfg_hash = (cfg.enabled, th_bits, ra_bits, at_bits, ho_bits, re_bits, rg_bits);
    }

    /// Sync coefficients from config if changed. RT-safe: pure arithmetic.
    pub fn sync(&mut self, cfg: &GateConfig, sample_rate: f32) {
        let th_bits = cfg.threshold_db.to_bits();
        let ra_bits = cfg.ratio.to_bits();
        let at_bits = cfg.attack_ms.to_bits();
        let ho_bits = cfg.hold_ms.to_bits();
        let re_bits = cfg.release_ms.to_bits();
        let rg_bits = cfg.range_db.to_bits();
        let current_hash = (cfg.enabled, th_bits, ra_bits, at_bits, ho_bits, re_bits, rg_bits);

        if current_hash != self.last_cfg_hash {
            self.update_coeffs(cfg, sample_rate);
            if !cfg.enabled {
                // Reset to closed when disabling
                self.state = GateState::Closed;
                self.current_gain = self.range_linear;
                self.hold_samples_remaining = 0;
            }
        }
    }

    /// Process a block in-place. Returns true if gate is currently OPEN or ATTACK (signal passing).
    /// RT-safe: no allocation, no locks.
    pub fn process_block(&mut self, buf: &mut [f32]) -> bool {
        if !self.enabled {
            return true;
        }

        for s in buf.iter_mut() {
            // Simple peak follower with slow decay (alpha = 0.9999)
            let alpha = 0.9999_f32;
            let sample_abs = s.abs();
            self.peak_follower = alpha * self.peak_follower + (1.0 - alpha) * sample_abs;

            // State machine
            match self.state {
                GateState::Closed => {
                    // Closed, gain at minimum (range_linear)
                    self.current_gain = self.range_linear;
                    if self.peak_follower > self.threshold_linear {
                        self.state = GateState::Attack;
                    }
                }
                GateState::Attack => {
                    // Ramp gain toward 1.0 (open) using attack coefficient
                    self.current_gain =
                        self.attack_coeff * self.current_gain + (1.0 - self.attack_coeff) * 1.0;
                    if self.current_gain >= 0.99 {
                        self.state = GateState::Open;
                        self.current_gain = 1.0;
                    }
                }
                GateState::Open => {
                    // Open, no attenuation
                    self.current_gain = 1.0;
                    if self.peak_follower < self.threshold_linear {
                        self.state = GateState::Hold;
                        self.hold_samples_remaining = self.hold_samples_total;
                    }
                }
                GateState::Hold => {
                    // Maintain 1.0 gain, decrement counter
                    self.current_gain = 1.0;
                    if self.peak_follower > self.threshold_linear {
                        // Signal returned above threshold during hold
                        self.state = GateState::Attack;
                    } else if self.hold_samples_remaining > 0 {
                        self.hold_samples_remaining -= 1;
                    } else {
                        // Hold time expired, start release
                        self.state = GateState::Release;
                    }
                }
                GateState::Release => {
                    // Ramp gain toward range_linear using release coefficient
                    self.current_gain =
                        self.release_coeff * self.current_gain
                            + (1.0 - self.release_coeff) * self.range_linear;
                    if self.current_gain <= self.range_linear + 1e-4 {
                        self.state = GateState::Closed;
                        self.current_gain = self.range_linear;
                    } else if self.peak_follower > self.threshold_linear {
                        // Signal returned above threshold during release
                        self.state = GateState::Attack;
                    }
                }
            }

            // Apply gain (gate expander gain on top of other effects)
            *s *= self.current_gain;
        }

        // Return true if gate is currently passing signal (final state)
        self.state == GateState::Open || self.state == GateState::Attack
    }

    /// Current gate state (for diagnostics).
    pub fn state(&self) -> &str {
        match self.state {
            GateState::Closed => "closed",
            GateState::Attack => "attack",
            GateState::Open => "open",
            GateState::Hold => "hold",
            GateState::Release => "release",
        }
    }
}

impl Default for GateExpander {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(threshold_db: f32, enabled: bool) -> GateConfig {
        GateConfig {
            enabled,
            threshold_db,
            ratio: 10.0,
            attack_ms: 1.0,
            hold_ms: 50.0,
            release_ms: 200.0,
            range_db: -60.0,
        }
    }

    #[test]
    fn disabled_gate_passes_signal_unchanged() {
        let mut gate = GateExpander::new();
        gate.sync(&cfg(-40.0, false), 48_000.0);
        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        let _ = gate.process_block(&mut buf);
        for (a, b) in input.iter().zip(buf.iter()) {
            assert!((a - b).abs() < 1e-6, "disabled gate must pass unchanged");
        }
    }

    #[test]
    fn gate_opens_on_loud_signal() {
        let mut gate = GateExpander::new();
        gate.sync(&cfg(-40.0, true), 48_000.0);
        // Signal well above threshold (-40dBFS): 0dBFS = 1.0, should open gate
        let mut buf = vec![0.9f32; 512];
        let gate_open = gate.process_block(&mut buf);
        // After settling, gate should be open or in attack
        assert!(gate_open, "gate should be open on loud signal");
        // Output should have similar level to input (gain ~= 1.0 after attack settles)
        for s in &buf[400..] {
            assert!(*s > 0.85, "loud signal should pass with minimal attenuation: {s}");
        }
    }

    #[test]
    fn gate_closes_on_silence() {
        let mut gate = GateExpander::new();
        let mut cfg = cfg(-40.0, true);
        // Short release time for faster settling in test
        cfg.release_ms = 20.0;
        cfg.hold_ms = 5.0;
        gate.sync(&cfg, 48_000.0);
        // First, drive gate open with loud signal
        let mut buf = vec![0.9f32; 512];
        let _ = gate.process_block(&mut buf);
        
        // Now drive with silence - peak follower with alpha=0.9999 needs ~500ms to settle
        // 500ms @ 48kHz = 24k samples
        let mut buf = vec![0.0f32; 30000];
        let gate_open = gate.process_block(&mut buf);
        // After release and peak follower decay, gate should be closed
        assert!(!gate_open, "gate should be closed on silence after peak decay; state={}", gate.state());
    }

    #[test]
    fn gate_attenuates_below_threshold() {
        let mut gate = GateExpander::new();
        // Threshold at -20dBFS, range at -60dBFS
        gate.sync(&cfg(-20.0, true), 48_000.0);
        // Signal at -40dBFS (0.01 linear): below threshold
        let level_linear = 10.0_f32.powf(-40.0 / 20.0);
        let mut buf = vec![level_linear; 512];
        let _ = gate.process_block(&mut buf);
        // After gate closes, output should be near -60dBFS
        let range_linear = 10.0_f32.powf(-60.0 / 20.0);
        let max_output = buf[400..].iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        assert!(
            max_output < range_linear * 2.0,
            "signal below threshold should be attenuated to range: {} < {}",
            max_output,
            range_linear * 2.0
        );
    }

    #[test]
    fn hold_timer_keeps_gate_open() {
        let mut gate = GateExpander::new();
        // Short hold time (20ms at 48kHz = 960 samples)
        let mut cfg = cfg(-40.0, true);
        cfg.hold_ms = 20.0;
        gate.sync(&cfg, 48_000.0);

        // Drive gate open
        let mut buf = vec![0.9f32; 256];
        let _ = gate.process_block(&mut buf);

        // Switch to silence for 500 samples (still within hold window)
        let mut buf = vec![0.0f32; 500];
        let gate_open = gate.process_block(&mut buf);
        // Gate should still be open or in hold (not yet released)
        assert!(
            gate_open || gate.state() == "hold",
            "gate should still be open during hold window"
        );
    }

    #[test]
    fn process_block_returns_gate_state() {
        let mut gate = GateExpander::new();
        let mut cfg = cfg(-40.0, true);
        cfg.release_ms = 20.0;
        cfg.hold_ms = 5.0;
        gate.sync(&cfg, 48_000.0);

        // Loud signal
        let mut buf = vec![0.9f32; 256];
        let result = gate.process_block(&mut buf);
        assert!(result, "process_block should return true when gate is open");

        // Silence for long enough for peak to decay below threshold
        let mut buf = vec![0.0f32; 30000];
        let result = gate.process_block(&mut buf);
        assert!(
            !result,
            "process_block should return false when gate is closed after peak decay"
        );
    }
}
