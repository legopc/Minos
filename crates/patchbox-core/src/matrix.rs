//! Routing matrix — routes N inputs to M outputs with gain staging

use crate::config::{EqConfig, LimiterConfig, PatchboxConfig};
use crate::dsp::eq::ParametricEq;
use crate::dsp::limiter::BrickWallLimiter;

/// Convert dB gain to linear amplitude multiplier
#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Per-output DSP chain: parametric EQ followed by brick-wall limiter.
pub struct PerOutputDsp {
    pub eq: ParametricEq,
    pub limiter: BrickWallLimiter,
    /// Gain reduction from last block in dB (0 = no reduction, negative = limiting active).
    /// Written by `process()`, read by metering.
    pub last_gr_db: f32,
}

impl PerOutputDsp {
    pub fn new() -> Self {
        Self {
            eq: ParametricEq::new(),
            limiter: BrickWallLimiter::new(),
            last_gr_db: 0.0,
        }
    }

    /// Sync coefficients from config if changed. RT-safe: pure arithmetic, no allocation.
    pub fn sync(&mut self, eq_cfg: &EqConfig, lim_cfg: &LimiterConfig, sample_rate: f32) {
        self.eq.sync(eq_cfg);
        self.limiter.sync(lim_cfg, sample_rate);
    }
}

impl Default for PerOutputDsp {
    fn default() -> Self { Self::new() }
}

/// Process one block of audio through the routing matrix.
///
/// `inputs[ch][sample]`  — RX channel buffers
/// `outputs[ch][sample]` — TX channel buffers (written in place)
/// `dsp`                 — per-output DSP state (EQ + limiter); must be len >= outputs.len()
///
/// RT-safe: no allocations, no locks.
pub fn process(
    inputs: &[&[f32]],
    outputs: &mut [&mut [f32]],
    config: &PatchboxConfig,
    dsp: &mut [PerOutputDsp],
    sample_rate: f32,
) {
    let nframes = outputs.first().map(|o| o.len()).unwrap_or(0);

    // Stack-allocated defaults used only when config vecs are shorter than channel count.
    let default_eq = EqConfig::default();
    let default_lim = LimiterConfig::default();

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

        // Apply output gain
        for s in output[..nframes].iter_mut() {
            *s *= out_gain;
        }

        // Apply per-output DSP: EQ then limiter (replaces the old soft_clip path)
        if let Some(d) = dsp.get_mut(tx_idx) {
            let eq_cfg  = config.per_output_eq.get(tx_idx).unwrap_or(&default_eq);
            let lim_cfg = config.per_output_limiter.get(tx_idx).unwrap_or(&default_lim);
            d.sync(eq_cfg, lim_cfg, sample_rate);
            d.eq.process_block(&mut output[..nframes]);
            let min_gr = d.limiter.process_block(&mut output[..nframes]);
            d.last_gr_db = if min_gr <= 0.0 { -120.0 } else { 20.0 * min_gr.log10() };
        }
    }
}
