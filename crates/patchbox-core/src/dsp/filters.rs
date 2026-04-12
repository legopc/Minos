//! RT-safe 2nd-order Butterworth HPF and LPF biquad filters.
//! No allocations, no locks — safe to call from the audio callback.

use crate::config::FilterConfig;

#[allow(dead_code)]
const SAMPLE_RATE: f32 = 48_000.0;
#[allow(dead_code)]
const Q_BUTTERWORTH: f32 = 0.7071067811865475; // 1/sqrt(2)

/// Filter mode: highpass or lowpass.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FilterMode {
    Highpass,
    Lowpass,
}

/// 2nd-order Butterworth filter (biquad) in transposed direct form II.
/// RT-safe: no allocation, no locks.
pub struct ButterworthFilter {
    mode: FilterMode,
    // Biquad coefficients (normalized by a0)
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    // Filter state (transposed direct form II)
    s1: f32,
    s2: f32,
    // Shadow of config for change detection
    last_enabled: bool,
    last_freq_hz: f32,
}

impl ButterworthFilter {
    pub fn new(mode: FilterMode) -> Self {
        Self {
            mode,
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            s1: 0.0,
            s2: 0.0,
            last_enabled: false,
            last_freq_hz: f32::NAN,
        }
    }

    /// Update coefficients if config changed. RT-safe: pure arithmetic.
    pub fn sync(&mut self, cfg: &FilterConfig, sample_rate: f32) {
        let changed = cfg.enabled != self.last_enabled
            || (cfg.freq_hz - self.last_freq_hz).abs() > 0.1;

        if changed {
            if cfg.enabled {
                self.compute_coefficients(cfg.freq_hz, sample_rate);
            } else {
                // Identity filter: passes signal unchanged
                self.b0 = 1.0;
                self.b1 = 0.0;
                self.b2 = 0.0;
                self.a1 = 0.0;
                self.a2 = 0.0;
                self.s1 = 0.0;
                self.s2 = 0.0;
            }
            self.last_enabled = cfg.enabled;
            self.last_freq_hz = cfg.freq_hz;
        }
    }

    fn compute_coefficients(&mut self, freq_hz: f32, sample_rate: f32) {
        // Clamp frequency based on filter type
        let freq_hz = match self.mode {
            FilterMode::Highpass => freq_hz.clamp(20.0, 8000.0),
            FilterMode::Lowpass => freq_hz.clamp(200.0, 20000.0),
        };

        let w0 = 2.0 * std::f32::consts::PI * freq_hz / sample_rate;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * Q_BUTTERWORTH);

        // Compute biquad coefficients using Audio EQ Cookbook formulas
        let (b0, b1, b2, a0, a1, a2) = match self.mode {
            FilterMode::Highpass => {
                // HPF
                let b0 = (1.0 + cos_w0) / 2.0;
                let b1 = -(1.0 + cos_w0);
                let b2 = (1.0 + cos_w0) / 2.0;
                let a0 = 1.0 + alpha;
                let a1 = -2.0 * cos_w0;
                let a2 = 1.0 - alpha;
                (b0, b1, b2, a0, a1, a2)
            }
            FilterMode::Lowpass => {
                // LPF
                let b0 = (1.0 - cos_w0) / 2.0;
                let b1 = 1.0 - cos_w0;
                let b2 = (1.0 - cos_w0) / 2.0;
                let a0 = 1.0 + alpha;
                let a1 = -2.0 * cos_w0;
                let a2 = 1.0 - alpha;
                (b0, b1, b2, a0, a1, a2)
            }
        };

        // Normalize by a0
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;

        // Reset state on coefficient update
        self.s1 = 0.0;
        self.s2 = 0.0;
    }

    /// Process a block in-place. RT-safe.
    #[inline]
    pub fn process_block(&mut self, buf: &mut [f32]) {
        for s in buf.iter_mut() {
            let y = self.b0 * *s + self.s1;
            self.s1 = self.b1 * *s - self.a1 * y + self.s2;
            self.s2 = self.b2 * *s - self.a2 * y;
            *s = y;
        }
    }
}

impl Default for ButterworthFilter {
    fn default() -> Self {
        Self::new(FilterMode::Highpass)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_hpf(enabled: bool, freq: f32) -> ButterworthFilter {
        let mut filter = ButterworthFilter::new(FilterMode::Highpass);
        let cfg = FilterConfig {
            enabled,
            freq_hz: freq,
        };
        filter.sync(&cfg, SAMPLE_RATE);
        filter
    }

    fn make_lpf(enabled: bool, freq: f32) -> ButterworthFilter {
        let mut filter = ButterworthFilter::new(FilterMode::Lowpass);
        let cfg = FilterConfig {
            enabled,
            freq_hz: freq,
        };
        filter.sync(&cfg, SAMPLE_RATE);
        filter
    }

    fn sine_wave(freq: f32, duration_samples: usize, sample_rate: f32) -> Vec<f32> {
        (0..duration_samples)
            .map(|i| {
                (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate).sin() * 0.5
            })
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn disabled_hpf_passes_signal_unchanged() {
        let mut filter = make_hpf(false, 80.0);
        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        filter.process_block(&mut buf);
        for (a, b) in input.iter().zip(buf.iter()) {
            assert!(
                (a - b).abs() < 1e-6,
                "disabled HPF must pass signal unchanged"
            );
        }
    }

    #[test]
    fn disabled_lpf_passes_signal_unchanged() {
        let mut filter = make_lpf(false, 2000.0);
        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        filter.process_block(&mut buf);
        for (a, b) in input.iter().zip(buf.iter()) {
            assert!(
                (a - b).abs() < 1e-6,
                "disabled LPF must pass signal unchanged"
            );
        }
    }

    #[test]
    fn hpf_attenuates_below_cutoff() {
        // 80 Hz HPF should attenuate 20 Hz sine significantly
        let mut filter = make_hpf(true, 80.0);
        let sine = sine_wave(20.0, 4800, SAMPLE_RATE);

        // Warmup (to settle filter state)
        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        // Process and measure
        let mut out = sine[480..].to_vec();
        filter.process_block(&mut out);

        let rms_in = rms(&sine[480..]);
        let rms_out = rms(&out);

        assert!(
            rms_out < rms_in * 0.4,
            "80Hz HPF should attenuate 20Hz by >60%: in_rms={:.4} out_rms={:.4}",
            rms_in,
            rms_out
        );
    }

    #[test]
    fn lpf_attenuates_above_cutoff() {
        // 2000 Hz LPF should attenuate 10 kHz sine significantly
        let mut filter = make_lpf(true, 2000.0);
        let sine = sine_wave(10000.0, 4800, SAMPLE_RATE);

        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        let mut out = sine[480..].to_vec();
        filter.process_block(&mut out);

        let rms_in = rms(&sine[480..]);
        let rms_out = rms(&out);

        assert!(
            rms_out < rms_in * 0.3,
            "2kHz LPF should attenuate 10kHz by >70%: in_rms={:.4} out_rms={:.4}",
            rms_in,
            rms_out
        );
    }

    #[test]
    fn hpf_passes_above_cutoff() {
        // 80 Hz HPF should pass 1000 Hz sine with minimal attenuation
        let mut filter = make_hpf(true, 80.0);
        let sine = sine_wave(1000.0, 4800, SAMPLE_RATE);

        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        let mut out = sine[480..].to_vec();
        filter.process_block(&mut out);

        let rms_in = rms(&sine[480..]);
        let rms_out = rms(&out);

        assert!(
            rms_out > rms_in * 0.9,
            "80Hz HPF should pass 1kHz with <10% loss: in_rms={:.4} out_rms={:.4}",
            rms_in,
            rms_out
        );
    }

    #[test]
    fn lpf_passes_below_cutoff() {
        // 2000 Hz LPF should pass 200 Hz sine with minimal attenuation
        let mut filter = make_lpf(true, 2000.0);
        let sine = sine_wave(200.0, 4800, SAMPLE_RATE);

        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        let mut out = sine[480..].to_vec();
        filter.process_block(&mut out);

        let rms_in = rms(&sine[480..]);
        let rms_out = rms(&out);

        assert!(
            rms_out > rms_in * 0.9,
            "2kHz LPF should pass 200Hz with <10% loss: in_rms={:.4} out_rms={:.4}",
            rms_in,
            rms_out
        );
    }

    #[test]
    fn sync_detects_no_change_and_preserves_state() {
        let mut filter = make_hpf(true, 80.0);
        let cfg = FilterConfig {
            enabled: true,
            freq_hz: 80.0,
        };

        // Get initial state after first sync
        let mut test_buf = vec![0.5f32; 32];
        filter.process_block(&mut test_buf);
        let s1_after_first = filter.s1;

        // Second sync with identical config should not reset state
        filter.sync(&cfg, SAMPLE_RATE);
        assert_eq!(
            filter.s1, s1_after_first,
            "sync with unchanged config should preserve state"
        );
    }

    #[test]
    fn sync_resets_state_on_enable_change() {
        let mut filter = ButterworthFilter::new(FilterMode::Highpass);
        let cfg = FilterConfig {
            enabled: true,
            freq_hz: 80.0,
        };
        filter.sync(&cfg, SAMPLE_RATE);

        // Process some samples to dirty the state
        let mut buf = vec![0.5f32; 64];
        filter.process_block(&mut buf);
        assert!(filter.s1 != 0.0 || filter.s2 != 0.0, "state should be dirty");

        // Disable and re-enable
        let cfg_disabled = FilterConfig {
            enabled: false,
            freq_hz: 80.0,
        };
        filter.sync(&cfg_disabled, SAMPLE_RATE);
        assert_eq!(filter.s1, 0.0, "state should reset on disable");
        assert_eq!(filter.s2, 0.0, "state should reset on disable");

        // Re-enable
        let cfg_enabled = FilterConfig {
            enabled: true,
            freq_hz: 80.0,
        };
        filter.sync(&cfg_enabled, SAMPLE_RATE);
        assert_eq!(filter.s1, 0.0, "state should reset on re-enable");
        assert_eq!(filter.s2, 0.0, "state should reset on re-enable");
    }
}
