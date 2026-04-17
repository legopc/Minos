// S7 s7-feat-lufs — EBU R128 loudness metering.
//
// Per-output LUFS short-term (3s window) and integrated (since reset).
// Implementation path:
//   1. Add `ebur128` crate to patchbox-core/Cargo.toml
//   2. Create `Lufs` struct wrapping `ebur128::EbuR128` per output
//   3. Call `add_frames_*` from PerOutputDsp::process_block
//   4. Expose short_term / integrated via /outputs/:ch/lufs
//   5. UI: add readout next to peak meter in mixer strip
//
// Config: no-op — always on, per-output, reset via POST /outputs/:ch/lufs/reset

#![allow(dead_code)]

pub struct Lufs {
    // TODO: ebur128::EbuR128
}

impl Lufs {
    pub fn new(_sample_rate: u32) -> Self { Self {} }
    pub fn process_block(&mut self, _samples: &[f32]) { /* TODO */ }
    pub fn short_term(&self) -> f32 { f32::NEG_INFINITY }
    pub fn integrated(&self) -> f32 { f32::NEG_INFINITY }
    pub fn reset(&mut self) { /* TODO */ }
}
