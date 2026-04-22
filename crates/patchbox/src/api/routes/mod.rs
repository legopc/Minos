// S7 api split target — see todo s7-arch-api-split.
//
// Plan: move handlers from crates/patchbox/src/api.rs (3049 lines) into
// per-resource modules here. Each module exposes a `pub fn router() -> Router<AppState>`
// and is mounted by api.rs.
//
// Extraction order (independent, can run in parallel on haiku agents):
//   inputs   — /inputs/... routes (+ DSP subroutes)
//   outputs  — /outputs/... routes (+ DSP subroutes)
//   buses    — /buses/...
//   zones    — /zones/...
//   scenes   — /scenes/...
//   routing  — /routes, /matrix, /bus-feeds
//   system   — /system, /health, /info
//   dsp      — shared DSP GET/PUT helpers used by inputs & outputs

pub mod buses;
pub mod dsp;
pub mod inputs;
pub mod outputs;
pub mod presets;
pub mod routing;
pub mod scenes;
pub mod system;
pub mod zones;
