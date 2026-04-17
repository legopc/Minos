//! patchbox-dante — Inferno AoIP integration
//!
//! Wraps inferno_aoip to create a Dante virtual device.
//! Feature-gated: build with --features inferno for real hardware.
//! Without the feature, a stub is provided for testing.

pub mod device;
pub mod monitor;
pub mod sample_conv;
pub mod stub;
