// S7 s7-feat-ab-compare — scene A/B compare + morph.
//
// Two slots A / B each holding a full-config snapshot. Toggle swaps active.
// Morph linearly interpolates scalar params (volume_db, gains, thresholds)
// over N ms; non-interpolable params (source selections) snap at midpoint.
//
// API:
//   POST /scenes/ab/load?slot=A&scene=<id>
//   POST /scenes/ab/toggle
//   POST /scenes/ab/morph?duration_ms=2000&direction=a-to-b
//   GET  /scenes/ab                        — {a, b, active, morph_progress}
//
// UI: new banner in scenes tab with A/B chips and morph slider.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AbCompareState {
    pub slot_a: Option<String>,   // scene id
    pub slot_b: Option<String>,   // scene id
    pub active: AbSlot,
    pub morph_ms_remaining: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
pub enum AbSlot { #[default] A, B }
