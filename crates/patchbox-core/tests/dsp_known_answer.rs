// Known-answer unit tests for patchbox-core DSP blocks.
// Run: cargo test -p patchbox-core

#[cfg(test)]
mod tests {
    use patchbox_core::config::{CompressorConfig, GateConfig, DuckerConfig};
    use patchbox_core::dsp::compressor::Compressor;
    use patchbox_core::dsp::gate::GateExpander;
    use patchbox_core::dsp::ducker::Ducker;
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
}
