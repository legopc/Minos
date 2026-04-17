// S7 s7-feat-sidechain-duck — dedicated ducker block.
//
// Ducker is a compressor whose detector signal is a different input/bus (key).
// Typical use: paging mic ducks background music.
//
// Plan:
//   1. DuckerConfig { enabled, bypassed, key_source: SourceId, threshold_db,
//      ratio, attack_ms, release_ms, range_db, hold_ms }
//   2. process_block(&mut self, signal: &mut [f32], key: &[f32])
//   3. Wire key routing in matrix.rs — needs sidechain tap from any bus/input
//   4. UI panel: source picker + standard comp controls + range/hold

#![allow(dead_code)]

pub struct Ducker {
    // TODO
}

impl Ducker {
    pub fn new(_sample_rate: u32) -> Self { Self {} }
    pub fn sync(&mut self /* , cfg: &DuckerConfig */) { /* TODO */ }
    pub fn process_block(&mut self, _signal: &mut [f32], _key: &[f32]) { /* TODO */ }
}
