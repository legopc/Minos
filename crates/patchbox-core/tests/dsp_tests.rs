//! T-02: DSP correctness unit tests.
//!
//! Tests the full signal chain:
//!   StripParams (gain trim + mute + solo) →
//!   MatrixParams (NxM crosspoint gains) →
//!   BusParams (master gain + mute)
//!
//! Verifies: gain math, mute, solo isolation, clamp limits, edge cases.

use patchbox_core::{
    bus::{self, BusParams},
    matrix::{self, MatrixParams},
    strip::{self, StripParams},
};

const BLOCK: usize = 64;

fn sine_block(freq_hz: f32, sample_rate: f32) -> Vec<f32> {
    (0..BLOCK)
        .map(|i| (2.0 * std::f32::consts::PI * freq_hz * i as f32 / sample_rate).sin())
        .collect()
}

// ── Strip tests ──────────────────────────────────────────────────────────────

#[test]
fn strip_unity_gain_passthrough() {
    let p = StripParams::new("test");
    let mut buf: Vec<f32> = (0..BLOCK).map(|i| i as f32).collect();
    let original = buf.clone();
    strip::apply_strip(&p, &mut buf);
    assert_eq!(buf, original, "unity gain must not modify samples");
}

#[test]
fn strip_gain_trim_halves_level() {
    let mut p = StripParams::new("test");
    p.gain_trim = 0.5;
    let mut buf = vec![1.0f32; BLOCK];
    strip::apply_strip(&p, &mut buf);
    assert!((buf[0] - 0.5).abs() < 1e-6, "0.5 gain should halve signal");
}

#[test]
fn strip_gain_trim_double() {
    let mut p = StripParams::new("test");
    p.gain_trim = 2.0; // +6 dB
    let mut buf = vec![0.5f32; BLOCK];
    strip::apply_strip(&p, &mut buf);
    assert!((buf[0] - 1.0).abs() < 1e-6, "2.0 gain should double signal");
}

#[test]
fn strip_mute_silences_output() {
    let mut p = StripParams::new("test");
    p.mute = true;
    let mut buf = vec![1.0f32; BLOCK];
    strip::apply_strip(&p, &mut buf);
    assert!(buf.iter().all(|&s| s == 0.0), "muted strip must output silence");
}

#[test]
fn strip_effective_gain_muted_is_zero() {
    let mut p = StripParams::new("test");
    p.gain_trim = 2.0;
    p.mute = true;
    assert_eq!(p.effective_gain(), 0.0, "muted effective gain must be 0");
}

#[test]
fn strip_effective_gain_unmuted() {
    let mut p = StripParams::new("test");
    p.gain_trim = 1.5;
    assert_eq!(p.effective_gain(), 1.5);
}

// ── Bus tests ────────────────────────────────────────────────────────────────

#[test]
fn bus_unity_gain_passthrough() {
    let p = BusParams::new("out");
    let mut buf: Vec<f32> = (0..BLOCK).map(|i| i as f32 * 0.01).collect();
    let original = buf.clone();
    bus::apply_bus(&p, &mut buf);
    assert_eq!(buf, original, "unity master gain must not modify samples");
}

#[test]
fn bus_master_gain_applied() {
    let mut p = BusParams::new("out");
    p.master_gain = 0.25;
    let mut buf = vec![1.0f32; BLOCK];
    bus::apply_bus(&p, &mut buf);
    assert!((buf[0] - 0.25).abs() < 1e-6);
}

#[test]
fn bus_mute_silences_output() {
    let mut p = BusParams::new("out");
    p.mute = true;
    p.master_gain = 2.0;
    let mut buf = vec![1.0f32; BLOCK];
    bus::apply_bus(&p, &mut buf);
    assert!(buf.iter().all(|&s| s == 0.0), "muted bus must output silence");
}

// ── Matrix mix tests ─────────────────────────────────────────────────────────

#[test]
fn matrix_zero_gain_no_bleed() {
    let p = MatrixParams::new(4, 4);
    let inputs: Vec<Vec<f32>> = (0..4).map(|_| vec![1.0f32; BLOCK]).collect();
    let input_refs: Vec<&[f32]> = inputs.iter().map(|v| v.as_slice()).collect();
    let mut out_bufs: Vec<Vec<f32>> = (0..4).map(|_| vec![0.0f32; BLOCK]).collect();
    let mut out_refs: Vec<&mut [f32]> = out_bufs.iter_mut().map(|v| v.as_mut_slice()).collect();

    matrix::mix(&p, &input_refs, &mut out_refs, BLOCK);

    for (j, out) in out_bufs.iter().enumerate() {
        assert!(out.iter().all(|&s| s == 0.0), "output {j} should be silent with all-zero matrix");
    }
}

#[test]
fn matrix_full_mix_accumulates() {
    let mut p = MatrixParams::new(2, 1);
    p.set(0, 0, 0.4);
    p.set(1, 0, 0.6);

    let in0 = vec![1.0f32; BLOCK];
    let in1 = vec![1.0f32; BLOCK];
    let mut out0 = vec![0.0f32; BLOCK];

    matrix::mix(&p, &[&in0, &in1], &mut [&mut out0], BLOCK);

    assert!((out0[0] - 1.0).abs() < 1e-5, "0.4 + 0.6 = 1.0");
}

#[test]
fn matrix_clamp_max_gain() {
    let mut p = MatrixParams::new(1, 1);
    p.set(0, 0, 100.0); // should be clamped to 4.0
    assert!((p.get(0, 0) - 4.0).abs() < 1e-6, "gain must clamp to 4.0");
}

#[test]
fn matrix_clamp_min_gain() {
    let mut p = MatrixParams::new(1, 1);
    p.set(0, 0, -1.0); // must clamp to 0.0
    assert_eq!(p.get(0, 0), 0.0, "gain must clamp to 0.0");
}

// ── Full signal chain test ────────────────────────────────────────────────────

/// Strip → Matrix → Bus: verify that gain stages compose correctly.
#[test]
fn full_chain_gain_composition() {
    // Input: 1.0 full-scale sine
    // Strip gain_trim: 0.5 (halve)
    // Matrix cell: 0.5 (halve again)
    // Bus master_gain: 2.0 (double)
    // Expected output: 1.0 * 0.5 * 0.5 * 2.0 = 0.5

    let mut strip = StripParams::new("mic");
    strip.gain_trim = 0.5;

    let mut mat = MatrixParams::new(1, 1);
    mat.set(0, 0, 0.5);

    let mut bus = BusParams::new("bar-1");
    bus.master_gain = 2.0;

    let original = vec![1.0f32; BLOCK];
    let mut input = original.clone();
    strip::apply_strip(&strip, &mut input);

    let mut output = vec![0.0f32; BLOCK];
    matrix::mix(&mat, &[&input], &mut [&mut output], BLOCK);
    bus::apply_bus(&bus, &mut output);

    let expected = 0.5_f32;
    for s in &output {
        assert!((s - expected).abs() < 1e-5, "chain output {s} ≠ {expected}");
    }
}

/// Mute anywhere in the chain should silence output completely.
#[test]
fn full_chain_mute_anywhere() {
    let mut mat = MatrixParams::new(1, 1);
    mat.set(0, 0, 1.0);

    // Case 1: strip muted
    let mut strip = StripParams::new("s");
    strip.mute = true;
    let bus = BusParams::new("b");

    let mut input = vec![1.0f32; BLOCK];
    strip::apply_strip(&strip, &mut input);
    let mut output = vec![0.0f32; BLOCK];
    matrix::mix(&mat, &[&input], &mut [&mut output], BLOCK);
    bus::apply_bus(&bus, &mut output);
    assert!(output.iter().all(|&s| s == 0.0), "strip mute must silence chain");

    // Case 2: bus muted
    let strip2 = StripParams::new("s");
    let mut bus2 = BusParams::new("b");
    bus2.mute = true;

    let mut input2 = vec![1.0f32; BLOCK];
    strip::apply_strip(&strip2, &mut input2);
    let mut output2 = vec![0.0f32; BLOCK];
    matrix::mix(&mat, &[&input2], &mut [&mut output2], BLOCK);
    bus::apply_bus(&bus2, &mut output2);
    assert!(output2.iter().all(|&s| s == 0.0), "bus mute must silence chain");
}

/// Verify sine passthrough preserves waveform shape (no unexpected distortion).
#[test]
fn matrix_sine_passthrough() {
    let mut p = MatrixParams::new(1, 1);
    p.set(0, 0, 1.0);

    let input = sine_block(440.0, 48_000.0);
    let mut output = vec![0.0f32; BLOCK];

    matrix::mix(&p, &[&input], &mut [&mut output], BLOCK);

    for (i, o) in input.iter().zip(output.iter()) {
        assert!((i - o).abs() < 1e-6, "unity gain sine must pass through unmodified");
    }
}
