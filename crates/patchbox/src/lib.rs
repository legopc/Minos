//! patchbox library — exposes modules for integration testing.
//!
//! The binary entry point is `src/main.rs`. This lib re-exports the
//! public modules so that `tests/` can build the router without a running
//! server.

pub mod api;
pub mod config;
pub mod state;
