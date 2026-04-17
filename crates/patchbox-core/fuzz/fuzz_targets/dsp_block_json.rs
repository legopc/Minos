#![cfg_attr(feature = "fuzzing", no_main)]

use patchbox_core::dsp::DspBlock;

#[cfg(feature = "fuzzing")]
use libfuzzer_sys::fuzz_target;

fn exercise(data: &[u8]) {
    // Exercise both new envelope and legacy flat deserializer paths.
    if let Ok(block) = serde_json::from_slice::<DspBlock<serde_json::Value>>(data) {
        if let Ok(out) = serde_json::to_vec(&block) {
            let _ = serde_json::from_slice::<DspBlock<serde_json::Value>>(&out);
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
