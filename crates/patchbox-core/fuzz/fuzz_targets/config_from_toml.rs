#![cfg_attr(feature = "fuzzing", no_main)]

use patchbox_core::config::PatchboxConfig;

#[cfg(feature = "fuzzing")]
use libfuzzer_sys::fuzz_target;

fn exercise(data: &[u8]) {
    if let Ok(s) = std::str::from_utf8(data) {
        if let Ok(mut cfg) = toml::from_str::<PatchboxConfig>(s) {
            if (1..=64).contains(&cfg.rx_channels) && (1..=64).contains(&cfg.tx_channels) {
                cfg.normalize();
            }
            let _ = cfg.validate();
        }
    }
}

#[cfg(feature = "fuzzing")]
fuzz_target!(|data: &[u8]| {
    exercise(data);
});

#[cfg(not(feature = "fuzzing"))]
fn main() {
    exercise(b"rx_channels = 2\ntx_channels = 2\n");
}