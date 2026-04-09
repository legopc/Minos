//! patchbox-core — routing matrix and DSP logic
//!
//! Pure logic, no I/O. Depends on nothing except serde.
//! All audio processing runs here, called from the Inferno RX callback.

pub mod config;
pub mod matrix;
pub mod gain;
pub mod meters;
