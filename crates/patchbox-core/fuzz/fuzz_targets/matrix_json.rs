#![cfg_attr(feature = "fuzzing", no_main)]

use patchbox_core::{config::PatchboxConfig, matrix::MatrixProcessor};

#[cfg(feature = "fuzzing")]
use libfuzzer_sys::fuzz_target;

fn exercise(data: &[u8]) {
    if let Ok(mut cfg) = serde_json::from_slice::<PatchboxConfig>(data) {
        if (1..=64).contains(&cfg.rx_channels) && (1..=64).contains(&cfg.tx_channels) {
            cfg.normalize();
            let mut m = MatrixProcessor::new(cfg.rx_channels, cfg.tx_channels, 48_000.0);
            m.sync(&cfg);
        }
    }
}

#[cfg(feature = "fuzzing")]
fuzz_target!(|data: &[u8]| {
    exercise(data);
});

#[cfg(not(feature = "fuzzing"))]
fn main() {
    exercise(b"{}");
}
