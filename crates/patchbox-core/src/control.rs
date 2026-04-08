//! Lock-free RT ↔ control thread parameter bridge.
//!
//! Uses `triple_buffer` to allow the control thread to publish a complete
//! `AudioParams` snapshot that the RT audio thread can read without locking.
//!
//! Usage:
//!   Control thread: `writer.write(new_params); writer.publish();`
//!   RT thread:      `if reader.update() { let p = reader.output_buffer(); ... }`

use crate::{bus::BusParams, matrix::MatrixParams, strip::StripParams};
use serde::{Deserialize, Serialize};

/// Complete audio-engine parameter set. Cloned on every publish.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioParams {
    pub matrix:  MatrixParams,
    pub inputs:  Vec<StripParams>,
    pub outputs: Vec<BusParams>,
}

impl AudioParams {
    pub fn new(n_inputs: usize, n_outputs: usize) -> Self {
        Self {
            matrix:  MatrixParams::new(n_inputs, n_outputs),
            inputs:  (0..n_inputs).map(|i| StripParams::new(format!("In {}", i + 1))).collect(),
            outputs: (0..n_outputs).map(|j| BusParams::new(format!("Out {}", j + 1))).collect(),
        }
    }
}

/// Live peak-metering data.
///
/// Updated at audio-callback rate (~20–48x/sec) from the RT thread,
/// read at ~20 Hz by the WebSocket meter push task.
/// Stored as dBFS (typically −60.0 .. 0.0).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeterFrame {
    /// Peak dBFS per input channel.
    pub inputs:  Vec<f32>,
    /// Peak dBFS per output channel.
    pub outputs: Vec<f32>,
}

impl MeterFrame {
    pub fn new(n_inputs: usize, n_outputs: usize) -> Self {
        Self {
            inputs:  vec![-60.0; n_inputs],
            outputs: vec![-60.0; n_outputs],
        }
    }

    /// Convert linear peak (0.0..1.0) to dBFS, floored at −60 dBFS.
    pub fn lin_to_dbfs(lin: f32) -> f32 {
        if lin <= 0.0 {
            -60.0
        } else {
            (20.0 * lin.log10()).max(-60.0)
        }
    }
}
