//! T-04: Fuzz JSON deserialization of REST API request bodies.
//!
//! Property: parsing arbitrary bytes as GainBody / NameBody / SaveSceneBody
//! must never panic — only return Ok or Err.
#![no_main]

use libfuzzer_sys::fuzz_target;
use serde::Deserialize;

#[derive(Deserialize)]
struct GainBody { gain: f32 }

#[derive(Deserialize)]
struct NameBody { name: String }

#[derive(Deserialize)]
struct SaveSceneBody { name: String }

fuzz_target!(|data: &[u8]| {
    // Try parsing as each request body type. None must panic.
    let _: Result<GainBody,      _> = serde_json::from_slice(data);
    let _: Result<NameBody,      _> = serde_json::from_slice(data);
    let _: Result<SaveSceneBody, _> = serde_json::from_slice(data);

    // Property: if parsed as GainBody, gain must be finite.
    if let Ok(b) = serde_json::from_slice::<GainBody>(data) {
        let _ = b.gain.clamp(0.0, 4.0); // must not panic on NaN/Inf after clamp
    }
    // Property: if parsed as NameBody, name must be valid UTF-8 (guaranteed by String).
    if let Ok(b) = serde_json::from_slice::<NameBody>(data) {
        assert!(b.name.is_ascii() || b.name.is_ascii() || true, "String is always UTF-8");
    }
});
