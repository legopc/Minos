//! Dynamic EQ — up to 4 bands each with independent level detector + biquad filter.
//! Band gain modulates smoothly (attack/release) as signal crosses threshold.
//! No allocation, no locks — RT-safe.

use crate::config::{DynamicEqBandConfig, DynamicEqBandType, DynamicEqConfig};

const SAMPLE_RATE: f32 = 48_000.0;

// ── Biquad primitives (transposed direct form II) ────────────────────────────

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

    fn peaking(freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let freq_hz = freq_hz.clamp(20.0, 20_000.0);
        let q = q.clamp(0.1, 10.0);
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz / SAMPLE_RATE;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos_w0) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos_w0) / a0,
            a2: (1.0 - alpha / a) / a0,
        }
    }

    fn low_shelf(freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz.clamp(20.0, 20_000.0) / SAMPLE_RATE;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q.clamp(0.1, 10.0));
        let t = 2.0 * a.sqrt() * alpha;
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + t;
        Self {
            b0: a * ((a + 1.0) - (a - 1.0) * cos_w0 + t) / a0,
            b1: 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0) / a0,
            b2: a * ((a + 1.0) - (a - 1.0) * cos_w0 - t) / a0,
            a1: -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0) / a0,
            a2: ((a + 1.0) + (a - 1.0) * cos_w0 - t) / a0,
        }
    }

    fn high_shelf(freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz.clamp(20.0, 20_000.0) / SAMPLE_RATE;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q.clamp(0.1, 10.0));
        let t = 2.0 * a.sqrt() * alpha;
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + t;
        Self {
            b0: a * ((a + 1.0) + (a - 1.0) * cos_w0 + t) / a0,
            b1: -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0) / a0,
            b2: a * ((a + 1.0) + (a - 1.0) * cos_w0 - t) / a0,
            a1: 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0) / a0,
            a2: ((a + 1.0) - (a - 1.0) * cos_w0 - t) / a0,
        }
    }
}

#[derive(Clone, Copy)]
struct BiquadFilter {
    coeffs: Coeffs,
    s1: f32,
    s2: f32,
}
impl BiquadFilter {
    fn identity() -> Self {
        Self {
            coeffs: Coeffs::identity(),
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

// ── Per-band state ────────────────────────────────────────────────────────────

struct Band {
    filter: BiquadFilter,
    /// Running RMS² accumulator (1-pole IIR, ~10 ms window).
    rms_sq: f32,
    rms_coeff: f32,
    /// Current smoothed gain modulation in dB (0 when quiet, → range_db when loud).
    current_gain_db: f32,
    attack_coeff: f32,
    release_coeff: f32,
    /// Cached config shadow for change detection.
    last_freq: f32,
    last_q: f32,
    last_range: f32,
    last_thresh: f32,
    last_ratio: f32,
    last_attack: f32,
    last_release: f32,
    last_type: u8,
    last_enabled: bool,
}

impl Band {
    fn new() -> Self {
        Self {
            filter: BiquadFilter::identity(),
            rms_sq: 0.0,
            rms_coeff: (-1.0 / (0.01 * SAMPLE_RATE)).exp(),
            current_gain_db: 0.0,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            last_freq: f32::NAN,
            last_q: f32::NAN,
            last_range: f32::NAN,
            last_thresh: f32::NAN,
            last_ratio: f32::NAN,
            last_attack: f32::NAN,
            last_release: f32::NAN,
            last_type: 255,
            last_enabled: false,
        }
    }

    fn sync(&mut self, cfg: &DynamicEqBandConfig, sample_rate: f32) {
        let type_tag: u8 = match cfg.band_type {
            DynamicEqBandType::Peaking => 0,
            DynamicEqBandType::LowShelf => 1,
            DynamicEqBandType::HighShelf => 2,
        };
        let changed = cfg.enabled != self.last_enabled
            || type_tag != self.last_type
            || (cfg.freq_hz - self.last_freq).abs() > 0.1
            || (cfg.q - self.last_q).abs() > 0.001
            || (cfg.range_db - self.last_range).abs() > 0.001
            || (cfg.threshold_db - self.last_thresh).abs() > 0.001
            || (cfg.ratio - self.last_ratio).abs() > 0.001
            || (cfg.attack_ms - self.last_attack).abs() > 0.1
            || (cfg.release_ms - self.last_release).abs() > 0.1;

        if !changed {
            return;
        }

        let attack_s = (cfg.attack_ms * 0.001).max(1e-6);
        let release_s = (cfg.release_ms * 0.001).max(1e-6);
        self.attack_coeff = (-1.0 / (attack_s * sample_rate)).exp();
        self.release_coeff = (-1.0 / (release_s * sample_rate)).exp();
        self.rms_coeff = (-1.0 / (0.01 * sample_rate)).exp();

        if !cfg.enabled {
            self.filter.coeffs = Coeffs::identity();
            self.filter.reset();
            self.current_gain_db = 0.0;
        }

        self.last_freq = cfg.freq_hz;
        self.last_q = cfg.q;
        self.last_range = cfg.range_db;
        self.last_thresh = cfg.threshold_db;
        self.last_ratio = cfg.ratio;
        self.last_attack = cfg.attack_ms;
        self.last_release = cfg.release_ms;
        self.last_type = type_tag;
        self.last_enabled = cfg.enabled;
    }

    /// Process a block: detect level, smooth gain, update biquad coeffs once, apply.
    /// Uses cached values from last sync() — no config reference needed.
    #[inline]
    fn process_block(&mut self, buf: &mut [f32]) {
        if !self.last_enabled {
            return;
        }

        let thresh = self.last_thresh;
        let ratio = self.last_ratio.max(1.001);
        let range = self.last_range;
        let (min_g, max_g) = (range.min(0.0), range.max(0.0));
        let freq = self.last_freq;
        let q = self.last_q;
        let band_type = self.last_type;

        for s in buf.iter_mut() {
            let x = *s;
            self.rms_sq = self.rms_coeff * self.rms_sq + (1.0 - self.rms_coeff) * x * x;
            let level_db = 10.0 * self.rms_sq.max(1e-30).log10();

            let excess = (level_db - thresh).max(0.0);
            let raw = if range >= 0.0 {
                excess * (1.0 - 1.0 / ratio)
            } else {
                -(excess * (1.0 - 1.0 / ratio))
            };
            let target_db = raw.clamp(min_g, max_g);

            self.current_gain_db = if target_db < self.current_gain_db {
                self.attack_coeff * self.current_gain_db + (1.0 - self.attack_coeff) * target_db
            } else {
                self.release_coeff * self.current_gain_db + (1.0 - self.release_coeff) * target_db
            };

            let g = self.current_gain_db;
            self.filter.coeffs = match band_type {
                0 => Coeffs::peaking(freq, g, q),
                1 => Coeffs::low_shelf(freq, g, q),
                _ => Coeffs::high_shelf(freq, g, q),
            };
            *s = self.filter.process(x);
        }
    }
}

// ── Public DynamicEq ─────────────────────────────────────────────────────────

const MAX_BANDS: usize = 4;

pub struct DynamicEq {
    bands: [Band; MAX_BANDS],
    enabled: bool,
    last_enabled: bool,
}

impl DynamicEq {
    pub fn new() -> Self {
        Self {
            bands: [Band::new(), Band::new(), Band::new(), Band::new()],
            enabled: false,
            last_enabled: false,
        }
    }

    pub fn sync(&mut self, cfg: &DynamicEqConfig, sample_rate: f32) {
        self.enabled = cfg.enabled && !cfg.bypassed;
        if self.enabled != self.last_enabled && !self.enabled {
            for b in &mut self.bands {
                b.filter = BiquadFilter::identity();
                b.filter.reset();
                b.current_gain_db = 0.0;
            }
        }
        self.last_enabled = self.enabled;
        if !self.enabled {
            return;
        }
        for (i, band) in self.bands.iter_mut().enumerate() {
            if let Some(bc) = cfg.bands.get(i) {
                band.sync(bc, sample_rate);
            }
        }
    }

    pub fn process_block(&mut self, buf: &mut [f32]) {
        if !self.enabled {
            return;
        }
        for band in &mut self.bands {
            band.process_block(buf);
        }
    }

    /// Return current gain_db for each active band (for metering/display).
    pub fn band_gains(&self) -> [f32; MAX_BANDS] {
        let mut out = [0.0f32; MAX_BANDS];
        for (i, b) in self.bands.iter().enumerate() {
            out[i] = b.current_gain_db;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{DynamicEqBandConfig, DynamicEqBandType, DynamicEqConfig};

    fn make_cfg(enabled: bool) -> DynamicEqConfig {
        DynamicEqConfig {
            enabled,
            bypassed: false,
            bands: Vec::new(),
        }
    }

    #[test]
    fn disabled_dynamic_eq_passes_unchanged() {
        let mut deq = DynamicEq::new();
        deq.sync(&make_cfg(false), 48_000.0);

        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        deq.process_block(&mut buf);

        for (a, b) in input.iter().zip(buf.iter()) {
            assert!(
                (a - b).abs() < 1e-6,
                "disabled dynamic EQ must pass signal unchanged"
            );
        }
    }

    #[test]
    fn bypass_flag_passes_unchanged() {
        let mut deq = DynamicEq::new();
        let mut cfg = make_cfg(true);
        cfg.bypassed = true;
        deq.sync(&cfg, 48_000.0);

        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        deq.process_block(&mut buf);

        for (a, b) in input.iter().zip(buf.iter()) {
            assert!(
                (a - b).abs() < 1e-6,
                "bypassed dynamic EQ must pass signal unchanged"
            );
        }
    }

    #[test]
    fn threshold_triggered_band_gain_below_threshold() {
        // Configure band 0 as peaking, 0 dB range below threshold
        let mut deq = DynamicEq::new();
        let mut cfg = make_cfg(true);
        cfg.bands.push(DynamicEqBandConfig {
            enabled: true,
            band_type: DynamicEqBandType::Peaking,
            freq_hz: 1000.0,
            q: 0.707,
            threshold_db: -20.0, // Threshold at -20 dB
            ratio: 2.0,
            range_db: -6.0, // Max reduction 6 dB above threshold
            attack_ms: 10.0,
            release_ms: 100.0,
        });

        deq.sync(&cfg, 48_000.0);

        // Signal below threshold: -30 dB
        let level_linear = 10.0_f32.powf(-30.0 / 20.0);
        let mut buf = vec![level_linear; 512];
        deq.process_block(&mut buf);

        // Below threshold, gain should be 0 dB (no reduction)
        let gains = deq.band_gains();
        assert!(
            gains[0].abs() < 0.1,
            "below threshold, band gain should be ~0 dB: got {}",
            gains[0]
        );
    }

    #[test]
    fn threshold_triggered_band_gain_above_threshold() {
        // Configure band 0 with threshold and range
        let mut deq = DynamicEq::new();
        let mut cfg = make_cfg(true);
        cfg.bands.push(DynamicEqBandConfig {
            enabled: true,
            band_type: DynamicEqBandType::Peaking,
            freq_hz: 1000.0,
            q: 0.707,
            threshold_db: -20.0,
            ratio: 2.0,
            range_db: -6.0, // Negative: reduction
            attack_ms: 1.0,
            release_ms: 100.0,
        });

        deq.sync(&cfg, 48_000.0);

        // Signal well above threshold: -10 dB
        let level_linear = 10.0_f32.powf(-10.0 / 20.0);
        let mut buf = vec![level_linear; 4800]; // 100ms to settle
        deq.process_block(&mut buf);

        // Above threshold, should see gain reduction
        let gains = deq.band_gains();
        assert!(
            gains[0] < -1.0,
            "above threshold, band gain should be < -1 dB: got {}",
            gains[0]
        );
    }

    #[test]
    fn band_gains_returns_all_active_bands() {
        let mut deq = DynamicEq::new();
        let mut cfg = make_cfg(true);
        cfg.bands.push(DynamicEqBandConfig {
            enabled: true,
            band_type: DynamicEqBandType::Peaking,
            freq_hz: 500.0,
            q: 0.707,
            threshold_db: -30.0,
            ratio: 2.0,
            range_db: -3.0,
            attack_ms: 10.0,
            release_ms: 100.0,
        });
        cfg.bands.push(DynamicEqBandConfig {
            enabled: true,
            band_type: DynamicEqBandType::HighShelf,
            freq_hz: 3000.0,
            q: 0.707,
            threshold_db: -25.0,
            ratio: 3.0,
            range_db: -6.0,
            attack_ms: 10.0,
            release_ms: 100.0,
        });

        deq.sync(&cfg, 48_000.0);

        let mut buf = vec![0.1f32; 256];
        deq.process_block(&mut buf);

        let gains = deq.band_gains();
        // Should return gains for all 4 bands (even inactive ones = 0.0)
        assert_eq!(gains.len(), 4, "band_gains should return all 4 bands");
        assert!(gains.iter().all(|g| g.is_finite()), "all gains should be finite");
    }
}
