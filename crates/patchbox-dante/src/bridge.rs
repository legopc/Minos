//! Audio thread ↔ DSP matrix bridge.
//!
//! Connects inferno_aoip RX audio callbacks → patchbox-core matrix → TX.
//! Stub until open question A2 (RT threading model) is resolved.

use patchbox_core::control::AudioParams;

/// Bridge between the Dante audio thread and the DSP matrix.
/// The `params` are read from a triple_buffer published by the control thread.
pub struct AudioBridge {
    pub block_size: usize,
}

impl AudioBridge {
    pub fn new(block_size: usize) -> Self {
        Self { block_size }
    }

    /// Process one audio block: apply strip gains, run matrix mix, apply bus gains.
    ///
    /// Called from the RT audio thread. Must not allocate or lock.
    pub fn process(
        &self,
        params:  &AudioParams,
        inputs:  &[&[f32]],
        outputs: &mut [&mut [f32]],
    ) {
        let bs = self.block_size;

        // Scratch buffer for strip-processed inputs (stack-allocated, bounded by MAX_CHANNELS)
        let mut scratch_storage = [[0.0f32; 512]; patchbox_core::matrix::MAX_CHANNELS];
        let n_in  = params.matrix.inputs.min(inputs.len());
        let n_out = params.matrix.outputs.min(outputs.len());

        // Apply input strip processing
        for i in 0..n_in {
            let gain = params.inputs[i].effective_gain();
            for s in 0..bs {
                scratch_storage[i][s] = inputs[i][s] * gain;
            }
        }

        // Build slice references for the matrix mixer
        let processed_inputs: Vec<&[f32]> = (0..n_in)
            .map(|i| &scratch_storage[i][..bs])
            .collect();

        patchbox_core::matrix::mix(&params.matrix, &processed_inputs, outputs, bs);

        // Apply output bus processing
        for j in 0..n_out {
            let gain = params.outputs[j].effective_gain();
            if gain != 1.0 {
                for s in 0..bs {
                    outputs[j][s] *= gain;
                }
            }
        }
    }
}
