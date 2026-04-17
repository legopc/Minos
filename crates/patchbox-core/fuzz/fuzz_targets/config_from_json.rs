#![cfg_attr(feature = "fuzzing", no_main)]

use patchbox_core::config::PatchboxConfig;

#[cfg(feature = "fuzzing")]
use libfuzzer_sys::fuzz_target;

fn exercise(data: &[u8]) {
    // Any bytes -> Ok or Err. Panics are crashes.
    if let Ok(mut cfg) = serde_json::from_slice::<PatchboxConfig>(data) {
        // Avoid pathological allocations in normalize() from attacker-controlled sizes.
        if (1..=64).contains(&cfg.rx_channels) && (1..=64).contains(&cfg.tx_channels) {
            cfg.normalize();
        }
        let _ = cfg.validate();

        // Round-trip should also be panic-safe.
        if let Ok(out) = serde_json::to_vec(&cfg) {
            let _ = serde_json::from_slice::<PatchboxConfig>(&out);
        }
    }
}

#[cfg(feature = "fuzzing")]
fuzz_target!(|data: &[u8]| {
    exercise(data);
});

#[cfg(not(feature = "fuzzing"))]
fn main() {
    // Allows `cargo check` on stable without libFuzzer/linker setup.
    exercise(b"{}");
}
