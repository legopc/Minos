//! NxM gain matrix.
//!
//! Each cell (input i, output j) holds a float gain coefficient:
//!   0.0 = muted / not routed
//!   1.0 = unity gain
//!
//! The matrix is designed to be updated from a control thread via
//! `MatrixParams` and consumed on the audio RT thread.

use serde::{Deserialize, Serialize};

/// Maximum supported input/output channels.
pub const MAX_CHANNELS: usize = 64;

/// The full NxM gain matrix (serializable for scenes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatrixParams {
    pub inputs:  usize,
    pub outputs: usize,
    /// Row-major: gains[input][output]
    pub gains: Vec<Vec<f32>>,
}

impl MatrixParams {
    pub fn new(inputs: usize, outputs: usize) -> Self {
        assert!(inputs  <= MAX_CHANNELS, "inputs exceed MAX_CHANNELS");
        assert!(outputs <= MAX_CHANNELS, "outputs exceed MAX_CHANNELS");
        Self {
            inputs,
            outputs,
            gains: vec![vec![0.0f32; outputs]; inputs],
        }
    }

    /// Set a single crosspoint gain (input i → output j).
    pub fn set(&mut self, input: usize, output: usize, gain: f32) {
        self.gains[input][output] = gain.clamp(0.0, 4.0);
    }

    /// Get a single crosspoint gain.
    pub fn get(&self, input: usize, output: usize) -> f32 {
        self.gains[input][output]
    }

    /// Toggle between 0.0 and 1.0 (routed vs not routed).
    pub fn toggle(&mut self, input: usize, output: usize) {
        let g = self.gains[input][output];
        self.gains[input][output] = if g > 0.0 { 0.0 } else { 1.0 };
    }
}

/// Real-time matrix mixer: mixes N input buffers into M output buffers.
///
/// All input/output buffers must have the same `block_size`.
/// This function is called from the audio thread and must not allocate.
pub fn mix(
    params:   &MatrixParams,
    inputs:   &[&[f32]],   // inputs[i] = input channel i, len = block_size
    outputs:  &mut [&mut [f32]], // outputs[j] = output channel j, len = block_size
    block_size: usize,
) {
    // Zero all output buffers first
    for out in outputs.iter_mut() {
        out[..block_size].fill(0.0);
    }

    for (i, input) in inputs.iter().enumerate().take(params.inputs) {
        for (j, output) in outputs.iter_mut().enumerate().take(params.outputs) {
            let gain = params.gains[i][j];
            if gain == 0.0 {
                continue;
            }
            for s in 0..block_size {
                output[s] += input[s] * gain;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_routing() {
        let mut p = MatrixParams::new(2, 2);
        p.set(0, 0, 1.0);
        p.set(1, 1, 1.0);

        let in0 = vec![1.0f32; 64];
        let in1 = vec![0.5f32; 64];
        let mut out0 = vec![0.0f32; 64];
        let mut out1 = vec![0.0f32; 64];

        mix(&p, &[&in0, &in1], &mut [&mut out0, &mut out1], 64);

        assert!((out0[0] - 1.0).abs() < 1e-6, "out0 should be 1.0");
        assert!((out1[0] - 0.5).abs() < 1e-6, "out1 should be 0.5");
    }

    #[test]
    fn mix_two_to_one() {
        let mut p = MatrixParams::new(2, 1);
        p.set(0, 0, 0.5);
        p.set(1, 0, 0.5);

        let in0 = vec![1.0f32; 64];
        let in1 = vec![1.0f32; 64];
        let mut out0 = vec![0.0f32; 64];

        mix(&p, &[&in0, &in1], &mut [&mut out0], 64);

        assert!((out0[0] - 1.0).abs() < 1e-6, "mixed output should be 1.0");
    }

    #[test]
    fn toggle() {
        let mut p = MatrixParams::new(2, 2);
        assert_eq!(p.get(0, 0), 0.0);
        p.toggle(0, 0);
        assert_eq!(p.get(0, 0), 1.0);
        p.toggle(0, 0);
        assert_eq!(p.get(0, 0), 0.0);
    }
}
