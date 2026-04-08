//! patchbox-dante — inferno_aoip integration.
//!
//! This crate bridges the Dante I/O layer (inferno_aoip) to patchbox-core.
//!
//! ## Open Questions (Phase 0)
//!
//! - **A1**: Does inferno_aoip expose a public Rust API for reading RX audio
//!   buffers and writing TX audio buffers? Or must we bridge at the ALSA /
//!   named-pipe level?  → inspect `inferno_aoip/src/lib.rs` in teodly/inferno.
//!
//! - **A2**: Can the DSP matrix run inline in the inferno audio callback, or
//!   do we need a ring-buffer bridge to a dedicated RT thread?
//!
//! Until A1 is resolved, this crate provides a `DanteDevice` stub that
//! simulates the I/O contract so the rest of the system can be built and tested.

pub mod device;
pub mod bridge;
