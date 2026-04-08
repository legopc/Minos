//! patchbox-core — real-time-safe NxM DSP matrix engine.
//!
//! This crate has **no I/O, no async, and no Dante dependency**.
//! It can be unit-tested in isolation and integrated into any audio thread.

pub mod matrix;
pub mod strip;
pub mod bus;
pub mod control;
pub mod scene;
pub mod eq;
pub mod compressor;
