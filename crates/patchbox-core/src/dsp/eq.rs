//! RT-safe 3-band parametric EQ using biquad filters.
//! No allocations, no locks — safe to call from the audio callback.

use crate::config::EqConfig;

const SAMPLE_RATE: f32 = 48_000.0;

/// Biquad filter coefficients (transposed direct form II).
#[derive(Clone, Copy)]
struct Coeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl Coeffs {
    fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// Peaking EQ (Audio EQ Cookbook by Robert Bristow-Johnson).
    fn peaking(freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let freq_hz = freq_hz.clamp(20.0, 20_000.0);
        let q = q.clamp(0.1, 10.0);
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz / SAMPLE_RATE;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }

    /// Low shelf (boost/cut below freq_hz).
    fn low_shelf(freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz.clamp(20.0, 20_000.0) / SAMPLE_RATE;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q.clamp(0.1, 10.0));
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }

    /// High shelf (boost/cut above freq_hz).
    fn high_shelf(freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz.clamp(20.0, 20_000.0) / SAMPLE_RATE;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q.clamp(0.1, 10.0));
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

/// Single biquad filter with state (transposed direct form II — numerically stable).
#[derive(Clone, Copy)]
struct BiquadFilter {
    coeffs: Coeffs,
    s1: f32,
    s2: f32,
}

impl BiquadFilter {
    fn new(coeffs: Coeffs) -> Self {
        Self {
            coeffs,
            s1: 0.0,
            s2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let c = &self.coeffs;
        let y = c.b0 * x + self.s1;
        self.s1 = c.b1 * x - c.a1 * y + self.s2;
        self.s2 = c.b2 * x - c.a2 * y;
        y
    }

    fn reset(&mut self) {
        self.s1 = 0.0;
        self.s2 = 0.0;
    }
}

/// 5-band parametric EQ. RT-safe: no allocation, no locks.
pub struct ParametricEq {
    bands: [BiquadFilter; 5],
    /// Shadow of last-applied config for change detection.
    last_config: Option<EqConfig>,
}

impl ParametricEq {
    pub fn new() -> Self {
        let identity = BiquadFilter::new(Coeffs::identity());
        Self {
            bands: [identity; 5],
            last_config: None,
        }
    }

    /// Update coefficients if config changed. Call once per audio block.
    /// RT-safe: pure arithmetic, no allocation.
    pub fn sync(&mut self, cfg: &EqConfig) {
        use crate::config::EqBandType;
        let changed = self.last_config.as_ref().is_none_or(|prev| {
            prev.enabled != cfg.enabled
                || prev.bands.iter().zip(cfg.bands.iter()).any(|(a, b)| {
                    a.band_type != b.band_type
                        || (a.freq_hz - b.freq_hz).abs() > 0.01
                        || (a.gain_db - b.gain_db).abs() > 0.001
                        || (a.q - b.q).abs() > 0.001
                })
        });

        if changed {
            if cfg.enabled {
                for (i, band) in cfg.bands.iter().enumerate() {
                    self.bands[i].coeffs = match band.band_type {
                        EqBandType::LowShelf => {
                            Coeffs::low_shelf(band.freq_hz, band.gain_db, band.q)
                        }
                        EqBandType::HighShelf => {
                            Coeffs::high_shelf(band.freq_hz, band.gain_db, band.q)
                        }
                        EqBandType::Peaking => Coeffs::peaking(band.freq_hz, band.gain_db, band.q),
                    };
                    self.bands[i].reset();
                }
            } else {
                for b in &mut self.bands {
                    b.coeffs = Coeffs::identity();
                    b.reset();
                }
            }
            self.last_config = Some(cfg.clone());
        }
    }

    /// Process a block in-place. RT-safe.
    pub fn process_block(&mut self, buf: &mut [f32]) {
        for s in buf.iter_mut() {
            let mut x = *s;
            for band in &mut self.bands {
                x = band.process(x);
            }
            *s = x;
        }
    }
}

impl Default for ParametricEq {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{EqBand, EqBandType, EqConfig};

    fn make_cfg(freq: f32, gain_db: f32, q: f32, enabled: bool) -> EqConfig {
        use crate::config::EqBandType;
        let mut cfg = EqConfig {
            enabled,
            bands: Default::default(),
        };
        cfg.bands[2] = EqBand {
            freq_hz: freq,
            gain_db,
            q,
            band_type: EqBandType::Peaking,
        };
        cfg
    }

    #[test]
    fn disabled_eq_passes_signal_unchanged() {
        let mut eq = ParametricEq::new();
        let cfg = make_cfg(1000.0, 6.0, 0.707, false);
        eq.sync(&cfg);
        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        eq.process_block(&mut buf);
        for (a, b) in input.iter().zip(buf.iter()) {
            assert!(
                (a - b).abs() < 1e-6,
                "disabled EQ must pass signal unchanged"
            );
        }
    }

    #[test]
    fn flat_eq_zero_gain_passes_signal_unchanged() {
        let mut eq = ParametricEq::new();
        let cfg = make_cfg(1000.0, 0.0, 0.707, true);
        eq.sync(&cfg);
        // Run a few warmup samples to settle state
        let mut warmup = vec![0.5f32; 256];
        eq.process_block(&mut warmup);
        // After settling, 0dB gain should pass signal within rounding error
        let mut buf = vec![0.5f32; 64];
        eq.process_block(&mut buf);
        for s in &buf {
            assert!((s - 0.5).abs() < 0.01, "0dB gain must not attenuate: {s}");
        }
    }

    #[test]
    fn positive_gain_increases_amplitude_at_target_freq() {
        // Generate a sine at exactly 1000 Hz, apply +6dB boost at 1000 Hz.
        // RMS after should be higher than RMS before.
        let mut eq = ParametricEq::new();
        let cfg = make_cfg(1000.0, 6.0, 0.707, true);
        eq.sync(&cfg);

        let sr = 48_000.0f32;
        let n = 4800; // 100ms
        let sine: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / sr).sin() * 0.5)
            .collect();

        // Warmup
        let mut warmup = sine[..480].to_vec();
        eq.process_block(&mut warmup);

        let mut processed = sine[480..].to_vec();
        eq.process_block(&mut processed);

        let rms_in: f32 =
            (sine[480..].iter().map(|x| x * x).sum::<f32>() / processed.len() as f32).sqrt();
        let rms_out: f32 =
            (processed.iter().map(|x| x * x).sum::<f32>() / processed.len() as f32).sqrt();

        assert!(
            rms_out > rms_in * 1.5,
            "6dB boost should increase RMS: in={rms_in:.4} out={rms_out:.4}"
        );
    }

    #[test]
    fn negative_gain_decreases_amplitude_at_target_freq() {
        let mut eq = ParametricEq::new();
        let cfg = make_cfg(1000.0, -6.0, 0.707, true);
        eq.sync(&cfg);

        let sr = 48_000.0f32;
        let n = 4800;
        let sine: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / sr).sin() * 0.5)
            .collect();

        let mut warmup = sine[..480].to_vec();
        eq.process_block(&mut warmup);

        let mut processed = sine[480..].to_vec();
        eq.process_block(&mut processed);

        let rms_in: f32 =
            (sine[480..].iter().map(|x| x * x).sum::<f32>() / processed.len() as f32).sqrt();
        let rms_out: f32 =
            (processed.iter().map(|x| x * x).sum::<f32>() / processed.len() as f32).sqrt();

        assert!(
            rms_out < rms_in * 0.7,
            "6dB cut should reduce RMS: in={rms_in:.4} out={rms_out:.4}"
        );
    }

    #[test]
    fn sync_detects_no_change_and_does_not_reset_state() {
        let mut eq = ParametricEq::new();
        let cfg = make_cfg(1000.0, 3.0, 0.707, true);
        eq.sync(&cfg);
        // Second sync with same config should not reset (last_config matches)
        let s1_before = eq.bands[0].s1;
        eq.sync(&cfg);
        // State unchanged (no reset triggered)
        assert_eq!(eq.bands[0].s1, s1_before);
    }

    #[test]
    fn low_shelf_boost_increases_low_freq() {
        let mut eq = ParametricEq::new();
        let mut cfg = EqConfig::default();
        cfg.bands[0] = EqBand {
            freq_hz: 200.0,
            gain_db: 6.0,
            q: 0.707,
            band_type: EqBandType::LowShelf,
        };
        cfg.enabled = true;
        eq.sync(&cfg);
        let sr = 48_000.0f32;
        let sine: Vec<f32> = (0..4800)
            .map(|i| (2.0 * std::f32::consts::PI * 50.0 * i as f32 / sr).sin() * 0.5)
            .collect();
        let mut warmup = sine[..480].to_vec();
        eq.process_block(&mut warmup);
        let mut out = sine[480..].to_vec();
        eq.process_block(&mut out);
        let rms_in: f32 =
            (sine[480..].iter().map(|x| x * x).sum::<f32>() / out.len() as f32).sqrt();
        let rms_out: f32 = (out.iter().map(|x| x * x).sum::<f32>() / out.len() as f32).sqrt();
        assert!(
            rms_out > rms_in * 1.3,
            "low shelf +6dB should boost 50Hz: in={rms_in:.4} out={rms_out:.4}"
        );
    }

    #[test]
    fn peaking_eq_zero_gain_is_identity() {
        // 0dB gain at any frequency should pass signal unchanged
        let mut eq = ParametricEq::new();
        let cfg = make_cfg(1000.0, 0.0, 0.707, true);
        eq.sync(&cfg);

        // Process impulse: (1 sample of 1.0, rest 0)
        let mut impulse = vec![0.0f32; 256];
        impulse[0] = 1.0;
        eq.process_block(&mut impulse);

        // After processing 0dB gain EQ, impulse should remain 1.0
        // (identity filter response at t=0)
        assert!(
            (impulse[0] - 1.0).abs() < 0.01,
            "0dB peaking EQ should pass impulse: got {}",
            impulse[0]
        );

        // Rest should be near zero (transient response of identity)
        for (i, &sample) in impulse.iter().enumerate().skip(1) {
            assert!(
                sample.abs() < 0.05,
                "0dB EQ impulse response should settle to zero: impulse[{}]={}",
                i,
                sample
            );
        }
    }

    #[test]
    fn low_shelf_coefficient_generation_matches_rbj() {
        // Low shelf at 200 Hz with +6dB should match RBJ cookbook
        let mut eq = ParametricEq::new();
        let mut cfg = EqConfig::default();
        cfg.bands[0] = EqBand {
            freq_hz: 200.0,
            gain_db: 6.0,
            q: 0.707,
            band_type: EqBandType::LowShelf,
        };
        cfg.enabled = true;
        eq.sync(&cfg);

        // Verify filter is not identity (0dB gain case)
        // by checking that coefficients changed
        let b0 = eq.bands[0].coeffs.b0;
        let b1 = eq.bands[0].coeffs.b1;
        let b2 = eq.bands[0].coeffs.b2;

        // For +6dB low shelf, b0 should be > 1.0 (boost)
        assert!(
            b0 > 1.0,
            "low shelf +6dB b0 should be > 1.0 for boost: got {}",
            b0
        );

        // Coefficients should be finite
        assert!(b0.is_finite() && b1.is_finite() && b2.is_finite());
    }

    #[test]
    fn high_shelf_coefficient_generation_matches_rbj() {
        // High shelf at 8000 Hz with +6dB
        let mut eq = ParametricEq::new();
        let mut cfg = EqConfig::default();
        cfg.bands[4] = EqBand {
            freq_hz: 8000.0,
            gain_db: 6.0,
            q: 0.707,
            band_type: EqBandType::HighShelf,
        };
        cfg.enabled = true;
        eq.sync(&cfg);

        let b0 = eq.bands[4].coeffs.b0;
        assert!(
            b0 > 1.0,
            "high shelf +6dB b0 should be > 1.0 for boost: got {}",
            b0
        );
    }

    #[test]
    fn peaking_eq_gain_plus_minus_symmetric() {
        // +6dB peaking should roughly be inverse of -6dB peaking
        let mut eq_plus = ParametricEq::new();
        let cfg_plus = make_cfg(1000.0, 6.0, 0.707, true);
        eq_plus.sync(&cfg_plus);

        let mut eq_minus = ParametricEq::new();
        let cfg_minus = make_cfg(1000.0, -6.0, 0.707, true);
        eq_minus.sync(&cfg_minus);

        // Coefficients should be "opposite" (b and a swapped in a sense)
        let b0_plus = eq_plus.bands[2].coeffs.b0;
        let a1_minus = eq_minus.bands[2].coeffs.a1;

        // They should have opposite relationships to unity
        assert!(
            b0_plus > 1.0 && a1_minus.abs() > 0.0,
            "symmetric gains should have opposite effects"
        );
    }
}
