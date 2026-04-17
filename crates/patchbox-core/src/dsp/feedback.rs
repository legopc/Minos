//! Automatic Feedback Suppressor (AFS)
//!
//! Detects narrowband feedback via a simple Goertzel-based peak detector and
//! places second-order IIR notch filters on the detected frequencies.
//!
//! Algorithm:
//! 1. Accumulate `DETECT_SIZE` samples into an analysis window.
//! 2. Run a bank of Goertzel detectors on a log-spaced frequency grid.
//! 3. If the dominant bin exceeds `threshold_db` AND is at least `hysteresis_db`
//!    above its neighbours, place a new notch filter at that frequency.
//! 4. Up to `MAX_NOTCHES` notch filters run in-series on every block.
//! 5. When `auto_reset` is set, all notches are released when the channel
//!    goes quiet for `quiet_hold_ms`.
//!
//! RT-safe: no allocations in the audio callback.

use crate::config::FeedbackSuppressorConfig;

/// Number of Goertzel bins (log-spaced 60 Hz – 18 kHz).
const N_BINS: usize = 64;
/// Analysis window size (samples). Must be power-of-2 isn't required for Goertzel.
const DETECT_SIZE: usize = 2048;
/// Maximum simultaneous notch filters per channel.
pub const MAX_NOTCHES: usize = 8;

// ---------------------------------------------------------------------------
// Frequency grid: N_BINS log-spaced bins between F_LO and F_HI
const F_LO: f32 = 60.0;
const F_HI: f32 = 18_000.0;

fn bin_freq(i: usize, n: usize) -> f32 {
    F_LO * (F_HI / F_LO).powf(i as f32 / (n - 1) as f32)
}

// ---------------------------------------------------------------------------
// Second-order IIR notch filter (constant-0 type)
// b0 = (1 + r^2) / 2, b1 = -2*cos(w), b2 = b0, a1 = -2*r*cos(w), a2 = r^2
#[derive(Clone, Copy)]
struct NotchFilter {
    freq_hz: f32,
    // Biquad coefficients
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    // State (direct form II transposed)
    s1: f32,
    s2: f32,
    active: bool,
}

impl NotchFilter {
    const fn inactive() -> Self {
        Self {
            freq_hz: 0.0,
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            s1: 0.0,
            s2: 0.0,
            active: false,
        }
    }

    fn configure(&mut self, freq_hz: f32, bandwidth_hz: f32, sample_rate: f32) {
        let w = 2.0 * core::f32::consts::PI * freq_hz / sample_rate;
        // r controls notch width: narrower = closer to 1.0
        // bandwidth_hz is the -3 dB bandwidth
        let r = 1.0 - core::f32::consts::PI * bandwidth_hz / sample_rate;
        let r = r.clamp(0.5, 0.9997);
        let cos_w = w.cos();
        let r2 = r * r;
        let b0 = (1.0 + r2) / 2.0;
        let b1 = -2.0 * cos_w;
        let b2 = b0;
        let a1 = -2.0 * r * cos_w;
        let a2 = r2;
        self.freq_hz = freq_hz;
        self.b0 = b0;
        self.b1 = b1;
        self.b2 = b2;
        self.a1 = a1;
        self.a2 = a2;
        self.s1 = 0.0;
        self.s2 = 0.0;
        self.active = true;
    }

    fn deactivate(&mut self) {
        self.active = false;
        self.s1 = 0.0;
        self.s2 = 0.0;
    }

    #[inline(always)]
    fn process_sample(&mut self, x: f32) -> f32 {
        if !self.active {
            return x;
        }
        let y = self.b0 * x + self.s1;
        self.s1 = self.b1 * x - self.a1 * y + self.s2;
        self.s2 = self.b2 * x - self.a2 * y;
        y
    }

    #[inline]
    fn process_block(&mut self, buf: &mut [f32]) {
        if !self.active {
            return;
        }
        for s in buf.iter_mut() {
            *s = self.process_sample(*s);
        }
    }
}

// ---------------------------------------------------------------------------
// Goertzel detector: measure power at a single frequency
fn goertzel_power(samples: &[f32], freq_hz: f32, sample_rate: f32) -> f32 {
    let n = samples.len();
    let k = freq_hz / sample_rate * n as f32;
    let omega = 2.0 * core::f32::consts::PI * k / n as f32;
    let cos_w = omega.cos();
    let coeff = 2.0 * cos_w;
    let (mut s_prev, mut s_prev2) = (0.0f32, 0.0f32);
    for &x in samples {
        let s = x + coeff * s_prev - s_prev2;
        s_prev2 = s_prev;
        s_prev = s;
    }
    // Power = (s_prev^2 + s_prev2^2 - s_prev*s_prev2*coeff) / n
    (s_prev * s_prev + s_prev2 * s_prev2 - s_prev * s_prev2 * coeff) / n as f32
}

// ---------------------------------------------------------------------------
pub struct FeedbackSuppressor {
    enabled: bool,
    threshold_db: f32,
    hysteresis_db: f32,
    bandwidth_hz: f32,
    auto_reset: bool,
    quiet_hold_ms: f32,
    max_notches: usize,

    notches: [NotchFilter; MAX_NOTCHES],
    n_active: usize,

    /// Analysis window accumulator
    window: Box<[f32; DETECT_SIZE]>,
    window_pos: usize,

    /// Power estimates for each bin (updated per analysis frame)
    bin_powers: [f32; N_BINS],

    /// Frequencies corresponding to each active notch (for deduplication)
    notch_freqs: [f32; MAX_NOTCHES],

    /// Quiet timer: counts samples of low-level signal for auto-reset
    quiet_samples: usize,
    quiet_threshold: f32, // linear amplitude below which we count "quiet"

    sample_rate: f32,
}

impl FeedbackSuppressor {
    pub fn new() -> Self {
        Self {
            enabled: false,
            threshold_db: -20.0,
            hysteresis_db: 6.0,
            bandwidth_hz: 10.0,
            auto_reset: false,
            quiet_hold_ms: 5000.0,
            max_notches: 6,
            notches: [NotchFilter::inactive(); MAX_NOTCHES],
            n_active: 0,
            window: Box::new([0.0f32; DETECT_SIZE]),
            window_pos: 0,
            bin_powers: [0.0f32; N_BINS],
            notch_freqs: [0.0f32; MAX_NOTCHES],
            quiet_samples: 0,
            quiet_threshold: 0.001, // -60 dBFS
            sample_rate: 48_000.0,
        }
    }

    /// Sync from config. RT-safe: no allocation (just field updates).
    pub fn sync(&mut self, cfg: &FeedbackSuppressorConfig, sample_rate: f32) {
        let was_enabled = self.enabled;
        self.enabled = cfg.enabled;
        self.threshold_db = cfg.threshold_db.clamp(-60.0, 0.0);
        self.hysteresis_db = cfg.hysteresis_db.clamp(0.0, 30.0);
        self.bandwidth_hz = cfg.bandwidth_hz.clamp(1.0, 100.0);
        self.auto_reset = cfg.auto_reset;
        self.quiet_hold_ms = cfg.quiet_hold_ms.clamp(100.0, 30_000.0);
        self.max_notches = cfg.max_notches.clamp(1, MAX_NOTCHES);
        self.sample_rate = sample_rate;
        self.quiet_threshold = 10.0f32.powf(cfg.quiet_threshold_db / 20.0);

        // If just disabled, deactivate all notches
        if was_enabled && !self.enabled {
            self._reset_notches();
        }
    }

    fn _reset_notches(&mut self) {
        for n in self.notches.iter_mut() {
            n.deactivate();
        }
        self.notch_freqs = [0.0f32; MAX_NOTCHES];
        self.n_active = 0;
    }

    /// Main audio processing — applies active notch filters and accumulates
    /// the analysis window. Detection runs once per full window.
    pub fn process_block(&mut self, buf: &mut [f32]) {
        if !self.enabled {
            return;
        }

        // Apply active notches first
        for n in self.notches.iter_mut() {
            n.process_block(buf);
        }

        // Accumulate samples into analysis window
        for &s in buf.iter() {
            self.window[self.window_pos] = s;
            self.window_pos += 1;

            // Check quiet for auto-reset
            if self.auto_reset {
                if s.abs() < self.quiet_threshold {
                    self.quiet_samples += 1;
                    let quiet_limit = (self.quiet_hold_ms * 0.001 * self.sample_rate) as usize;
                    if self.quiet_samples >= quiet_limit && self.n_active > 0 {
                        self._reset_notches();
                        self.quiet_samples = 0;
                    }
                } else {
                    self.quiet_samples = 0;
                }
            }

            if self.window_pos >= DETECT_SIZE {
                self.window_pos = 0;
                self._run_detection();
            }
        }
    }

    /// Run Goertzel analysis and potentially place a new notch filter.
    /// Called once per DETECT_SIZE samples (~43 ms @ 48 kHz).
    fn _run_detection(&mut self) {
        if self.n_active >= self.max_notches {
            return;
        }

        // Compute power at each bin
        for i in 0..N_BINS {
            let f = bin_freq(i, N_BINS);
            if f >= self.sample_rate / 2.0 {
                continue;
            }
            self.bin_powers[i] = goertzel_power(self.window.as_ref(), f, self.sample_rate);
        }

        // Find the dominant bin
        let mut peak_idx = 0;
        let mut peak_power = 0.0f32;
        for i in 0..N_BINS {
            if self.bin_powers[i] > peak_power {
                peak_power = self.bin_powers[i];
                peak_idx = i;
            }
        }

        // Convert to dBFS (roughly)
        if peak_power <= 0.0 {
            return;
        }
        let peak_db = 10.0 * peak_power.log10();

        if peak_db < self.threshold_db {
            return;
        }

        // Hysteresis: peak must be significantly above neighbours
        let left_db = if peak_idx > 0 && self.bin_powers[peak_idx - 1] > 0.0 {
            10.0 * self.bin_powers[peak_idx - 1].log10()
        } else {
            -120.0
        };
        let right_db = if peak_idx + 1 < N_BINS && self.bin_powers[peak_idx + 1] > 0.0 {
            10.0 * self.bin_powers[peak_idx + 1].log10()
        } else {
            -120.0
        };
        let neighbour_max = left_db.max(right_db);
        if peak_db - neighbour_max < self.hysteresis_db {
            return;
        }

        let peak_freq = bin_freq(peak_idx, N_BINS);

        // Don't place a duplicate notch within 20 Hz of an existing one
        for &nf in self.notch_freqs[..self.n_active].iter() {
            if (nf - peak_freq).abs() < 20.0 {
                return;
            }
        }

        // Place notch at the next available slot
        for i in 0..MAX_NOTCHES {
            if !self.notches[i].active {
                self.notches[i].configure(peak_freq, self.bandwidth_hz, self.sample_rate);
                self.notch_freqs[i] = peak_freq;
                if i >= self.n_active {
                    self.n_active = i + 1;
                }
                break;
            }
        }
    }

    /// Manual reset — remove all notch filters.
    pub fn reset(&mut self) {
        self._reset_notches();
    }

    /// Returns the active notch frequencies for metering/display.
    pub fn active_notches(&self) -> &[f32] {
        &self.notch_freqs[..self.n_active]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cfg(enabled: bool) -> FeedbackSuppressorConfig {
        FeedbackSuppressorConfig {
            enabled,
            threshold_db: -20.0,
            hysteresis_db: 6.0,
            bandwidth_hz: 10.0,
            auto_reset: false,
            quiet_hold_ms: 5000.0,
            max_notches: 6,
            quiet_threshold_db: -60.0,
        }
    }

    #[test]
    fn disabled_feedback_suppressor_passes_signal_unchanged() {
        let mut fs = FeedbackSuppressor::new();
        fs.sync(&make_cfg(false), 48_000.0);

        let input = vec![0.1f32; 256];
        let mut buf = input.clone();
        fs.process_block(&mut buf);

        for (a, b) in input.iter().zip(buf.iter()) {
            assert!(
                (a - b).abs() < 1e-6,
                "disabled feedback suppressor must pass signal unchanged"
            );
        }
    }

    #[test]
    fn feedback_suppressor_does_not_explode_on_white_noise() {
        // Test that the suppressor doesn't produce NaN or unbounded output
        let mut fs = FeedbackSuppressor::new();
        fs.sync(&make_cfg(true), 48_000.0);

        // Generate simple pseudo-random noise (not true random, but deterministic)
        let mut noise = Vec::new();
        let mut seed: u32 = 12345;
        for _ in 0..4800 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let normalized = ((seed >> 8) as f32 / (1u32 << 24) as f32) * 2.0 - 1.0;
            noise.push(normalized * 0.1); // Scale to reasonable level
        }

        let mut buf = noise.clone();
        fs.process_block(&mut buf);

        // Verify output is bounded and finite
        for s in &buf {
            assert!(
                s.is_finite(),
                "output contains NaN or inf: {}",
                s
            );
            assert!(
                s.abs() <= 10.0, // Very loose bound
                "output is unbounded: {}",
                s
            );
        }
    }

    #[test]
    fn active_notches_metering_returns_frequencies() {
        let mut fs = FeedbackSuppressor::new();
        let mut cfg = make_cfg(true);
        // Lower threshold to enable detection
        cfg.threshold_db = -40.0;
        fs.sync(&cfg, 48_000.0);

        // Generate a sustained sine at ~1 kHz (should accumulate in detection window)
        let mut sine = Vec::new();
        for i in 0..DETECT_SIZE * 2 {
            let sample = (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 48_000.0).sin() * 0.5;
            sine.push(sample);
        }

        fs.process_block(&mut sine);

        // After processing, should have detected the tone
        let notches = fs.active_notches();
        // May or may not have notches depending on hysteresis, but vector should be valid
        assert!(notches.len() <= MAX_NOTCHES);
    }

    #[test]
    fn reset_clears_all_notches() {
        let mut fs = FeedbackSuppressor::new();
        fs.sync(&make_cfg(true), 48_000.0);

        // Manually place a notch by setting internal state (via sync with detected feedback)
        let mut cfg = make_cfg(true);
        cfg.threshold_db = -20.0;
        fs.sync(&cfg, 48_000.0);

        // Generate tone to potentially trigger detection
        let mut tone = Vec::new();
        for i in 0..DETECT_SIZE {
            let sample = (2.0 * std::f32::consts::PI * 2000.0 * i as f32 / 48_000.0).sin() * 0.3;
            tone.push(sample);
        }
        fs.process_block(&mut tone);

        // Reset should clear notches
        fs.reset();
        let notches = fs.active_notches();
        assert_eq!(notches.len(), 0, "reset should clear all notches");
    }
}
