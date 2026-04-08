//! patchbox-dante — inferno_aoip integration.
//!
//! This crate bridges the Dante I/O layer (`inferno_aoip`) to `patchbox-core`.
//!
//! ## Architecture (A1 + A2 resolved)
//!
//! - **A1 resolved**: `inferno_aoip` exposes a direct Rust API:
//!   - `DeviceServer::start(settings)` — starts mDNS, ARC, CMC, multicast servers
//!   - `server.receive_with_callback(Box::new(cb))` — RX callback `Fn(usize, &Vec<Vec<Sample>>)`
//!   - `server.transmit_from_external_buffer(bufs, start_rx, timestamp, notifier)` — TX ring buffers
//!   - `Sample = i32` (24-bit PCM packed in lower 24 bits)
//!
//! - **A2 resolved**: DSP matrix runs **inline in the RX callback**. The TX path
//!   uses `ExternalBufferParameters<Sample>` ring buffers that inferno_aoip reads
//!   from. The RX callback writes processed samples into those buffers.
//!   Parameter updates from the control thread are lock-free via `triple_buffer`.
//!
//! ## Feature flag
//!
//! Compile with `--features inferno` to enable real Dante I/O. Without the flag
//! the crate uses silence stubs so the rest of the system builds and tests in CI
//! without a Dante network or PTP clock daemon.

pub mod bridge;
pub mod device;
pub mod sample_conv;

