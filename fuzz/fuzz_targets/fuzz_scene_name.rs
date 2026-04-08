//! T-04: Fuzz scene name sanitisation.
//!
//! Property: `sanitise_name()` must never panic for any byte input,
//! and must reject names containing path-traversal sequences.
#![no_main]

use libfuzzer_sys::fuzz_target;
use patchbox_core::scene::sanitise_name;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let result = sanitise_name(s);
        // Property: if name contains ".." or "/" it must be rejected.
        if s.contains("..") || s.contains('/') || s.contains('\\') {
            assert!(result.is_err(), "path traversal name was accepted: {:?}", s);
        }
        // Property: empty name must be rejected.
        if s.is_empty() {
            assert!(result.is_err(), "empty name was accepted");
        }
        // Property: names over 64 chars must be rejected.
        if s.len() > 64 {
            assert!(result.is_err(), "oversized name was accepted: len={}", s.len());
        }
    }
    // Non-UTF-8 input: must not panic (simply ignore)
});
