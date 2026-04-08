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
