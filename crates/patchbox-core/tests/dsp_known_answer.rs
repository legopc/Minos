// Known-answer unit tests for patchbox-core DSP blocks.
// Run: cargo test -p patchbox-core

#[cfg(test)]
mod tests {
    use patchbox_core::config::{
        CompressorConfig, DuckerConfig, DynamicEqBandConfig, DynamicEqBandType,
        DynamicEqConfig, FeedbackSuppressorConfig, FilterConfig, GateConfig,
    };
    use patchbox_core::dsp::compressor::Compressor;
    use patchbox_core::dsp::deq::DynamicEq;
    use patchbox_core::dsp::ducker::Ducker;
    use patchbox_core::dsp::feedback::FeedbackSuppressor;
    use patchbox_core::dsp::filters::{ButterworthFilter, FilterMode};
    use patchbox_core::dsp::gate::GateExpander;
    use patchbox_core::dsp::lufs::Lufs;

    const SR: f32 = 48000.0;

    fn cmp_cfg(threshold_db: f32, ratio: f32, knee_db: f32) -> CompressorConfig {
        CompressorConfig {
            enabled: true,
            threshold_db,
            ratio,
            knee_db,
            attack_ms: 0.1,   // Very fast so steady-state is reached quickly in tests
            release_ms: 0.1,
            makeup_db: 0.0,
        }
    }

    /// Fill a buffer with a constant DC level (linear amplitude).
    fn dc_block(amp: f32, n: usize) -> Vec<f32> {
        vec![amp; n]
    }

    // ── Compressor ────────────────────────────────────────────────────────────

    #[test]
    fn compressor_no_reduction_below_threshold() {
        let cfg = cmp_cfg(-20.0, 4.0, 0.0);
        let mut cmp = Compressor::new();
        cmp.sync(&cfg, SR);

        // Signal at -40 dBFS — well below threshold
        let amp = 10f32.powf(-40.0 / 20.0);
        let mut buf = dc_block(amp, 4800); // 100 ms at 48 kHz
        cmp.process_block(&mut buf);

        // All samples should be (virtually) unchanged
        for &s in &buf[4000..] {
            assert!((s - amp).abs() < amp * 0.01, "expected ~no gain reduction, got {s}");
        }
    }

    #[test]
    fn compressor_hard_knee_gain_reduction() {
        // No knee, threshold = -20 dB, ratio = 4:1
        // Signal = 0 dBFS (amp = 1.0).
        // Excess above threshold = 20 dB → GR = 20 * (1 - 1/4) = 15 dB
        // Expected output level ≈ -15 dBFS → amp ≈ 0.178
        let cfg = cmp_cfg(-20.0, 4.0, 0.0);
        let mut cmp = Compressor::new();
        cmp.sync(&cfg, SR);

        let amp = 1.0_f32;
        let mut buf = dc_block(amp, 48000); // 1 second — enough to reach steady state
        cmp.process_block(&mut buf);

        let tail_rms: f32 = {
            let n = 4800usize;
            let tail = &buf[buf.len() - n..];
            (tail.iter().map(|s| s * s).sum::<f32>() / n as f32).sqrt()
        };
        let tail_db = 20.0 * tail_rms.log10();
        // Expect roughly -15 dBFS ± 2 dB (attack smoothing leaves small residual)
        assert!(
            tail_db > -17.0 && tail_db < -13.0,
            "expected ~-15 dBFS, got {tail_db:.1} dBFS"
        );
    }

    #[test]
    fn compressor_disabled_passes_through() {
        let mut cfg = cmp_cfg(-20.0, 4.0, 0.0);
        cfg.enabled = false;
        let mut cmp = Compressor::new();
        cmp.sync(&cfg, SR);

        let amp = 1.0_f32;
        let mut buf = dc_block(amp, 4800);
        cmp.process_block(&mut buf);

        for &s in &buf {
            assert!((s - amp).abs() < 1e-6, "disabled compressor modified signal");
        }
    }

    // ── Gate ──────────────────────────────────────────────────────────────────

    fn gate_cfg(threshold_db: f32) -> GateConfig {
        GateConfig {
            enabled: true,
            threshold_db,
            ratio: 0.1,
            attack_ms: 0.1,
            hold_ms: 0.0,
            release_ms: 0.1,
            range_db: -80.0,
        }
    }

    #[test]
    fn gate_opens_above_threshold() {
        let cfg = gate_cfg(-40.0);
        let mut gate = GateExpander::new();
        gate.sync(&cfg, SR);

        // Send a loud signal — gate should open
        let amp = 10f32.powf(-20.0 / 20.0); // -20 dBFS — above -40 dB threshold
        let mut buf = dc_block(amp, 4800);
        let open = gate.process_block(&mut buf);

        assert!(open, "gate should be open with signal above threshold");
        // Opened gate should not significantly attenuate
        let tail_mean: f32 = buf[4000..].iter().map(|s| s.abs()).sum::<f32>() / 800.0;
        assert!(tail_mean > amp * 0.5, "gate applied unexpected attenuation when open");
    }

    #[test]
    fn gate_closes_below_threshold() {
        let cfg = gate_cfg(-20.0);
        let mut gate = GateExpander::new();
        gate.sync(&cfg, SR);

        // Send a quiet signal — gate should stay closed
        let amp = 10f32.powf(-60.0 / 20.0); // -60 dBFS — well below -20 dB threshold
        let mut buf = dc_block(amp, 4800);
        let open = gate.process_block(&mut buf);

        assert!(!open, "gate should be closed with signal below threshold");
        // Closed gate should attenuate heavily
        let tail_mean: f32 = buf[4000..].iter().map(|s| s.abs()).sum::<f32>() / 800.0;
        assert!(tail_mean < amp * 0.1, "gate did not attenuate signal when closed");
    }

    // ── Ducker ────────────────────────────────────────────────────────────────

    fn ducker_cfg(threshold_db: f32, ratio: f32) -> DuckerConfig {
        DuckerConfig {
            enabled: true,
            bypassed: false,
            threshold_db,
            ratio,
            range_db: -40.0,
            attack_ms: 0.1,
            release_ms: 0.1,
            sidechain_source_id: None,
        }
    }

    #[test]
    fn ducker_attenuates_when_sidechain_active() {
        let cfg = ducker_cfg(-30.0, 6.0);
        let mut ducker = Ducker::new(cfg, SR);

        // Sidechain at -10 dBFS (above threshold)
        let sc_amp = 10f32.powf(-10.0 / 20.0);

        let mut buf = dc_block(1.0_f32, 4800);
        // Run several blocks so envelope converges
        for _ in 0..10 {
            ducker.process_block(&mut buf, sc_amp);
        }

        let tail_mean: f32 = buf[4000..].iter().map(|s| s.abs()).sum::<f32>() / 800.0;
        // Expect significant attenuation (> 6 dB)
        assert!(tail_mean < 0.5, "ducker did not attenuate signal (tail_mean={tail_mean:.4})");
        assert!(ducker.last_gr_db() < -0.1, "last_gr_db should be negative when ducking");
    }

    #[test]
    fn ducker_passes_through_with_quiet_sidechain() {
        let cfg = ducker_cfg(-30.0, 6.0);
        let mut ducker = Ducker::new(cfg, SR);

        // Sidechain at -60 dBFS (below threshold)
        let sc_amp = 10f32.powf(-60.0 / 20.0);

        let amp = 0.5_f32;
        let mut buf = dc_block(amp, 4800);
        for _ in 0..10 {
            ducker.process_block(&mut buf, sc_amp);
        }

        let tail_mean: f32 = buf[4000..].iter().map(|s| s.abs()).sum::<f32>() / 800.0;
        assert!(tail_mean > amp * 0.9, "ducker attenuated with quiet sidechain (unexpected)");
    }

    // ── LUFS ─────────────────────────────────────────────────────────────────

    #[test]
    fn lufs_integrated_tracks_1khz_sine() {
        // EBU R128 reference: 1 kHz sine at -23 dBFS ≈ -23 LUFS integrated.
        // Momentary/short-term convergence needs ~3 s; integrated needs more.
        // We test only that the integrated value is finite and < 0 after feeding signal.
        let mut lufs = Lufs::new(SR as u32, 1);

        let amp = 10f32.powf(-23.0 / 20.0);
        let block_size = 4800usize;
        let phase_step = 2.0 * std::f32::consts::PI * 1000.0 / SR;
        let mut buf = vec![0.0f32; block_size];

        // Feed 3 seconds of sine (interleaved, 1 channel)
        for blk in 0..30 {
            for i in 0..block_size {
                buf[i] = amp * (((blk * block_size + i) as f32) * phase_step).sin();
            }
            lufs.process_block(&buf);
        }

        let m = lufs.momentary_lufs();
        let s = lufs.short_term_lufs();
        let i = lufs.integrated_lufs();

        assert!(m.is_finite() && m < 0.0, "momentary should be finite and negative, got {m}");
        assert!(s.is_finite() && s < 0.0, "short_term should be finite and negative, got {s}");
        assert!(i.is_finite() && i < 0.0, "integrated should be finite and negative, got {i}");
    }

    #[test]
    fn lufs_reset_clears_readings() {
        let mut lufs = Lufs::new(SR as u32, 1);
        let amp = 10f32.powf(-23.0 / 20.0);
        let buf: Vec<f32> = (0..4800).map(|i| amp * (i as f32 * 0.1).sin()).collect();

        for _ in 0..30 {
            lufs.process_block(&buf);
        }
        // Should have readings now
        assert!(lufs.integrated_lufs().is_finite());

        lufs.reset();
        // After reset, integrated should be NEG_INFINITY (uninitialised)
        assert!(
            lufs.integrated_lufs().is_infinite() && lufs.integrated_lufs() < 0.0,
            "after reset, integrated should be -inf"
        );
    }

    // ── Biquad Filter Behavior (Known-Answer) ──────────────────────────────────

    fn sine_wave(freq_hz: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq_hz * i as f32 / SR).sin())
            .collect()
    }

    fn rms_level(buf: &[f32]) -> f32 {
        let sum_sq = buf.iter().map(|s| s * s).sum::<f32>();
        (sum_sq / buf.len() as f32).sqrt()
    }

    #[test]
    fn hpf_passes_high_frequencies_1khz() {
        let mut filter = ButterworthFilter::new(FilterMode::Highpass);
        filter.sync(&FilterConfig { enabled: true, freq_hz: 500.0 }, SR);

        let sine = sine_wave(1000.0, 4800);
        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        let mut buf = sine[480..].to_vec();
        filter.process_block(&mut buf);

        let in_rms = rms_level(&sine[480..]);
        let out_rms = rms_level(&buf);
        assert!(
            out_rms > in_rms * 0.85,
            "1kHz should pass through 500Hz HPF with <15% loss, got {:.3} -> {:.3}",
            in_rms,
            out_rms
        );
    }

    #[test]
    fn hpf_blocks_low_frequencies_100hz() {
        let mut filter = ButterworthFilter::new(FilterMode::Highpass);
        filter.sync(&FilterConfig { enabled: true, freq_hz: 500.0 }, SR);

        let sine = sine_wave(100.0, 4800);
        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        let mut buf = sine[480..].to_vec();
        filter.process_block(&mut buf);

        let in_rms = rms_level(&sine[480..]);
        let out_rms = rms_level(&buf);
        assert!(
            out_rms < in_rms * 0.3,
            "100Hz should be attenuated by 500Hz HPF by >70%, got {:.4} -> {:.4}",
            in_rms,
            out_rms
        );
    }

    #[test]
    fn lpf_passes_low_frequencies_500hz() {
        let mut filter = ButterworthFilter::new(FilterMode::Lowpass);
        filter.sync(&FilterConfig { enabled: true, freq_hz: 2000.0 }, SR);

        let sine = sine_wave(500.0, 4800);
        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        let mut buf = sine[480..].to_vec();
        filter.process_block(&mut buf);

        let in_rms = rms_level(&sine[480..]);
        let out_rms = rms_level(&buf);
        assert!(
            out_rms > in_rms * 0.85,
            "500Hz should pass through 2kHz LPF with <15% loss, got {:.3} -> {:.3}",
            in_rms,
            out_rms
        );
    }

    #[test]
    fn lpf_blocks_high_frequencies_8khz() {
        let mut filter = ButterworthFilter::new(FilterMode::Lowpass);
        filter.sync(&FilterConfig { enabled: true, freq_hz: 2000.0 }, SR);

        let sine = sine_wave(8000.0, 4800);
        let mut warmup = sine[..480].to_vec();
        filter.process_block(&mut warmup);

        let mut buf = sine[480..].to_vec();
        filter.process_block(&mut buf);

        let in_rms = rms_level(&sine[480..]);
        let out_rms = rms_level(&buf);
        assert!(
            out_rms < in_rms * 0.3,
            "8kHz should be attenuated by 2kHz LPF by >70%, got {:.4} -> {:.4}",
            in_rms,
            out_rms
        );
    }

    #[test]
    fn disabled_filter_passes_unchanged() {
        let mut hpf = ButterworthFilter::new(FilterMode::Highpass);
        let mut lpf = ButterworthFilter::new(FilterMode::Lowpass);

        hpf.sync(&FilterConfig { enabled: false, freq_hz: 1000.0 }, SR);
        lpf.sync(&FilterConfig { enabled: false, freq_hz: 1000.0 }, SR);

        let input = vec![0.5f32; 64];
        let mut hpf_buf = input.clone();
        let mut lpf_buf = input.clone();
        hpf.process_block(&mut hpf_buf);
        lpf.process_block(&mut lpf_buf);

        for (a, b) in input.iter().zip(hpf_buf.iter()) {
            assert!((a - b).abs() < 1e-6, "disabled HPF must pass unchanged");
        }
        for (a, b) in input.iter().zip(lpf_buf.iter()) {
            assert!((a - b).abs() < 1e-6, "disabled LPF must pass unchanged");
        }
    }

    // ── Dynamic EQ (DEQ) Band Response ─────────────────────────────────────────

    #[test]
    fn deq_band_gain_below_threshold_near_zero() {
        let mut deq = DynamicEq::new();
        let cfg = DynamicEqConfig {
            enabled: true,
            bypassed: false,
            bands: vec![DynamicEqBandConfig {
                enabled: true,
                band_type: DynamicEqBandType::Peaking,
                freq_hz: 1000.0,
                q: 1.4,
                threshold_db: -20.0,
                ratio: 4.0,
                range_db: -6.0,
                attack_ms: 10.0,
                release_ms: 100.0,
            }],
        };
        deq.sync(&cfg, SR);

        let level_linear = 10.0_f32.powf(-30.0 / 20.0);
        let mut buf = vec![level_linear; 1024];
        deq.process_block(&mut buf);

        let gains = deq.band_gains();
        assert!(
            gains[0].abs() < 0.5,
            "DEQ band gain should be near 0 dB below threshold, got {:.2} dB",
            gains[0]
        );
    }

    #[test]
    fn deq_band_gain_above_threshold_negative() {
        let mut deq = DynamicEq::new();
        let cfg = DynamicEqConfig {
            enabled: true,
            bypassed: false,
            bands: vec![DynamicEqBandConfig {
                enabled: true,
                band_type: DynamicEqBandType::Peaking,
                freq_hz: 1000.0,
                q: 1.4,
                threshold_db: -20.0,
                ratio: 4.0,
                range_db: -6.0,
                attack_ms: 1.0,
                release_ms: 100.0,
            }],
        };
        deq.sync(&cfg, SR);

        let level_linear = 10.0_f32.powf(-10.0 / 20.0);
        let mut buf = vec![level_linear; 4800];
        deq.process_block(&mut buf);

        let gains = deq.band_gains();
        assert!(
            gains[0] < -1.0,
            "DEQ band gain should be negative above threshold, got {:.2} dB",
            gains[0]
        );
    }

    #[test]
    fn deq_passes_through_when_disabled() {
        let mut deq = DynamicEq::new();
        deq.sync(&DynamicEqConfig { enabled: false, bypassed: false, bands: vec![] }, SR);

        let input = vec![0.5f32; 64];
        let mut buf = input.clone();
        deq.process_block(&mut buf);

        for (a, b) in input.iter().zip(buf.iter()) {
            assert!((a - b).abs() < 1e-6, "disabled DEQ must pass signal unchanged");
        }
    }

    // ── Automatic Feedback Suppressor (AFS) Detection ─────────────────────────

    #[test]
    fn afs_detects_sustained_tone_and_places_notch() {
        let mut fs = FeedbackSuppressor::new();
        let cfg = FeedbackSuppressorConfig {
            enabled: true,
            threshold_db: -40.0,
            hysteresis_db: 3.0,
            bandwidth_hz: 10.0,
            auto_reset: false,
            quiet_hold_ms: 5000.0,
            max_notches: 6,
            quiet_threshold_db: -60.0,
        };
        fs.sync(&cfg, SR);

        let freq_hz = 2049.0_f32;
        let sample_count = 4800 * 10;
        let mut tone = Vec::with_capacity(sample_count);
        for i in 0..sample_count {
            let s = (2.0 * std::f32::consts::PI * freq_hz * i as f32 / SR).sin() * 0.5;
            tone.push(s);
        }

        fs.process_block(&mut tone);

        let notches = fs.active_notches();
        assert!(
            !notches.is_empty(),
            "AFS should have placed at least one notch for sustained 2049Hz tone"
        );
        if !notches.is_empty() {
            let first_notch = notches[0];
            assert!(
                (first_notch - freq_hz).abs() < 100.0,
                "Notch frequency should be near {:.0}Hz, got {:.0} Hz",
                freq_hz,
                first_notch
            );
        }
    }

    #[test]
    fn afs_disabled_passes_signal_unchanged() {
        let mut fs = FeedbackSuppressor::new();
        fs.sync(&FeedbackSuppressorConfig { enabled: false, threshold_db: -20.0, hysteresis_db: 6.0, bandwidth_hz: 10.0, auto_reset: false, quiet_hold_ms: 5000.0, max_notches: 6, quiet_threshold_db: -60.0 }, SR);

        let input = vec![0.1f32; 256];
        let mut buf = input.clone();
        fs.process_block(&mut buf);

        for (a, b) in input.iter().zip(buf.iter()) {
            assert!((a - b).abs() < 1e-6, "disabled AFS must pass signal unchanged");
        }
    }

    #[test]
    fn afs_reset_clears_notches() {
        let mut fs = FeedbackSuppressor::new();
        let cfg = FeedbackSuppressorConfig {
            enabled: true,
            threshold_db: -40.0,
            hysteresis_db: 3.0,
            bandwidth_hz: 10.0,
            auto_reset: false,
            quiet_hold_ms: 5000.0,
            max_notches: 6,
            quiet_threshold_db: -60.0,
        };
        fs.sync(&cfg, SR);

        let freq_hz = 1500.0_f32;
        let mut tone = Vec::with_capacity(4800 * 5);
        for i in 0..4800 * 5 {
            let s = (2.0 * std::f32::consts::PI * freq_hz * i as f32 / SR).sin() * 0.5;
            tone.push(s);
        }
        fs.process_block(&mut tone);

        fs.reset();
        let notches = fs.active_notches();
        assert_eq!(notches.len(), 0, "reset() should clear all notches");
    }
}
