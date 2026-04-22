// S7 s7-feat-lufs — EBU R128 loudness metering.
//
// Per-output LUFS short-term (3s window) and integrated (since reset).
// Wire: call process_block from PerOutputDsp::process_block after mixing.
// Expose readings via GET /outputs/:ch/lufs; reset via POST /outputs/:ch/lufs/reset.

use ebur128::{EbuR128, Mode};

pub struct Lufs {
    meter: Option<EbuR128>,
    integrated: f64,
    short_term: f64,
    momentary: f64,
    sample_rate: u32,
    channels: u32,
}

impl Lufs {
    pub fn new(sample_rate: u32, channels: u32) -> Self {
        let meter = EbuR128::new(channels, sample_rate, Mode::I | Mode::S | Mode::M).ok();
        Self {
            meter,
            integrated: f64::NEG_INFINITY,
            short_term: f64::NEG_INFINITY,
            momentary: f64::NEG_INFINITY,
            sample_rate,
            channels,
        }
    }

    /// Feed interleaved f32 frames to the meter and refresh cached readings.
    pub fn process_block(&mut self, samples: &[f32]) {
        let Some(meter) = self.meter.as_mut() else { return };
        if meter.add_frames_f32(samples).is_ok() {
            if let Ok(v) = meter.loudness_global() {
                self.integrated = v;
            }
            if let Ok(v) = meter.loudness_shortterm() {
                self.short_term = v;
            }
            if let Ok(v) = meter.loudness_momentary() {
                self.momentary = v;
            }
        }
    }

    pub fn integrated_lufs(&self) -> f64 { self.integrated }
    pub fn short_term_lufs(&self) -> f64 { self.short_term }
    pub fn momentary_lufs(&self) -> f64 { self.momentary }

    /// Reset the meter and clear all cached readings.
    pub fn reset(&mut self) {
        self.integrated = f64::NEG_INFINITY;
        self.short_term = f64::NEG_INFINITY;
        self.momentary = f64::NEG_INFINITY;
        // Reinitialise: ebur128 has no reset(), so recreate.
        self.meter = EbuR128::new(self.channels, self.sample_rate, Mode::I | Mode::S | Mode::M).ok();
    }

    // Legacy accessors kept for compatibility with existing call sites.
    pub fn short_term(&self) -> f32 { self.short_term as f32 }
    pub fn integrated(&self) -> f32 { self.integrated as f32 }
}
