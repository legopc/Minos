//! Audio thread ↔ DSP matrix bridge.
//!
//! ## Architecture (A1 + A2 resolved)
//!
//! `inferno_aoip` uses `Sample = i32` (24-bit PCM, packed in 32-bit signed).
//! Our DSP engine uses `f32`. This module handles the conversion and wiring.
//!
//! **Data flow (RT callback)**:
//! ```text
//! inferno RX i32 → normalise f32 → apply_strip → matrix::mix → apply_bus → TX i32
//! ```
//!
//! The `process()` function is called from the inferno RX callback.
//! It **must not allocate or lock** — all buffers are stack-based.

use patchbox_core::control::AudioParams;

/// Maximum channels and block size supported without heap allocation.
const MAX_CH: usize = patchbox_core::matrix::MAX_CHANNELS;
const MAX_BS: usize = 512;

pub struct AudioBridge {
    pub block_size: usize,
}

impl AudioBridge {
    pub fn new(block_size: usize) -> Self {
        assert!(block_size <= MAX_BS, "block_size {block_size} exceeds MAX_BS {MAX_BS}");
        Self { block_size }
    }

    /// Process one audio block: strip gains → matrix mix → bus gains.
    ///
    /// `inputs`  — one `&[f32]` per input channel, each of length `block_size`
    /// `outputs` — one `&mut [f32]` per output channel, zeroed on entry
    ///
    /// RT-safe: stack allocations only, no locks, no system calls.
    pub fn process(
        &self,
        params:  &AudioParams,
        inputs:  &[&[f32]],
        outputs: &mut [&mut [f32]],
    ) {
        let bs    = self.block_size;
        let n_in  = params.matrix.inputs.min(inputs.len()).min(MAX_CH);
        let n_out = params.matrix.outputs.min(outputs.len()).min(MAX_CH);

        // Stack-allocated scratch: strip-processed f32 inputs
        let mut scratch = [[0.0f32; MAX_BS]; MAX_CH];

        for i in 0..n_in {
            let gain = params.inputs[i].effective_gain();
            for s in 0..bs {
                scratch[i][s] = inputs[i][s] * gain;
            }
        }

        let processed: Vec<&[f32]> = (0..n_in)
            .map(|i| &scratch[i][..bs])
            .collect();

        patchbox_core::matrix::mix(&params.matrix, &processed, outputs, bs);

        for j in 0..n_out {
            let gain = params.outputs[j].effective_gain();
            if gain != 1.0 {
                for s in 0..bs {
                    outputs[j][s] *= gain;
                }
            }
        }
    }

    /// Convenience: process from/to `i32` (inferno_aoip native format).
    /// Allocates per-call — use only outside the RT hot path.
    pub fn process_i32(
        &self,
        params:  &AudioParams,
        rx:      &[Vec<i32>],
        tx:      &mut [Vec<i32>],
        count:   usize,
    ) {
        use crate::sample_conv::{f32_to_i32, i32_to_f32};

        let bs    = count.min(self.block_size);
        let n_in  = rx.len().min(params.matrix.inputs);
        let n_out = tx.len().min(params.matrix.outputs);

        let rx_f32: Vec<Vec<f32>> = (0..n_in)
            .map(|i| rx[i][..bs].iter().map(|&s| i32_to_f32(s)).collect())
            .collect();

        let mut tx_f32: Vec<Vec<f32>> = (0..n_out)
            .map(|_| vec![0.0f32; bs])
            .collect();

        let inputs_ref:  Vec<&[f32]>      = rx_f32.iter().map(|v| v.as_slice()).collect();
        let mut outputs_ref: Vec<&mut [f32]> = tx_f32.iter_mut().map(|v| v.as_mut_slice()).collect();

        self.process(params, &inputs_ref, &mut outputs_ref);

        for j in 0..n_out {
            for s in 0..bs {
                tx[j][s] = f32_to_i32(tx_f32[j][s]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use patchbox_core::control::AudioParams;

    fn unity_params(n: usize) -> AudioParams {
        AudioParams::new(n, n)
    }

    #[test]
    fn passthrough_unity() {
        let mut params = unity_params(2);
        // Route input 0 → output 0 and input 1 → output 1 at unity
        params.matrix.set(0, 0, 1.0);
        params.matrix.set(1, 1, 1.0);

        let block = vec![1.0f32; 64];
        let silence = vec![0.0f32; 64];
        let inputs: Vec<&[f32]> = vec![&block, &silence];

        let mut out0 = vec![0.0f32; 64];
        let mut out1 = vec![0.0f32; 64];
        let mut outputs: Vec<&mut [f32]> = vec![&mut out0, &mut out1];

        let bridge = AudioBridge::new(64);
        bridge.process(&params, &inputs, &mut outputs);

        assert!((out0[0] - 1.0).abs() < 1e-6);
        assert!(out1[0].abs() < 1e-6);
    }

    #[test]
    fn mute_silences_output() {
        let mut params = unity_params(1);
        params.matrix.set(0, 0, 1.0);
        params.inputs[0].mute = true;

        let block = vec![1.0f32; 64];
        let inputs: Vec<&[f32]> = vec![&block];
        let mut out = vec![0.0f32; 64];
        let mut outputs: Vec<&mut [f32]> = vec![&mut out];

        AudioBridge::new(64).process(&params, &inputs, &mut outputs);

        assert!(out.iter().all(|&s| s.abs() < 1e-6));
    }
}

