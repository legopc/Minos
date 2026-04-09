//! Routing matrix — routes N inputs to M outputs with gain staging

use crate::config::PatchboxConfig;

/// Convert dB gain to linear amplitude multiplier
#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Simple soft-clip limiter — protects amps from digital overs.
/// Passes signals below ±0.9 unaltered; smoothly compresses above that.
#[inline]
fn soft_clip(x: f32) -> f32 {
    if x.abs() <= 0.9 {
        x
    } else {
        let sign = x.signum();
        sign * (0.9 + (x.abs() - 0.9) / (1.0 + ((x.abs() - 0.9) / 0.1).powi(2)))
    }
}

/// Process one block of audio through the routing matrix.
///
/// `inputs[ch][sample]`  — RX channel buffers
/// `outputs[ch][sample]` — TX channel buffers (written in place)
///
/// RT-safe: no allocations, no locks.
pub fn process(
    inputs: &[&[f32]],
    outputs: &mut [&mut [f32]],
    config: &PatchboxConfig,
) {
    let nframes = outputs.first().map(|o| o.len()).unwrap_or(0);

    for (tx_idx, output) in outputs.iter_mut().enumerate() {
        let out_gain = db_to_linear(
            config.output_gain_db.get(tx_idx).copied().unwrap_or(0.0)
        );

        // Zero output buffer
        for s in output.iter_mut() {
            *s = 0.0;
        }

        // If zone is muted, leave output silent and skip mixing
        if config.output_muted.get(tx_idx).copied().unwrap_or(false) {
            continue;
        }

        // Mix all routed sources into this output
        for (rx_idx, input) in inputs.iter().enumerate() {
            let routed = config
                .matrix
                .get(tx_idx)
                .and_then(|row| row.get(rx_idx))
                .copied()
                .unwrap_or(false);

            if routed {
                let in_gain = db_to_linear(
                    config.input_gain_db.get(rx_idx).copied().unwrap_or(0.0)
                );
                for (s_out, s_in) in output[..nframes].iter_mut().zip(input[..nframes].iter()) {
                    *s_out += s_in * in_gain;
                }
            }
        }

        // Apply output gain and soft-clip limiter per sample
        for s in output[..nframes].iter_mut() {
            *s = soft_clip(*s * out_gain);
        }
    }
}
