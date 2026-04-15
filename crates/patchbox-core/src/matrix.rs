//! Routing matrix — routes N inputs to M outputs with gain staging

use crate::config::{EqConfig, InputChannelDsp, LimiterConfig, OutputChannelDsp, PatchboxConfig};
use crate::dsp::compressor::Compressor;
use crate::dsp::delay::DelayLine;
use crate::dsp::eq::ParametricEq;
use crate::dsp::filters::{ButterworthFilter, FilterMode};
use crate::dsp::gate::GateExpander;
use crate::dsp::limiter::BrickWallLimiter;

/// Convert dB gain to linear amplitude multiplier
#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Compute per-sample blend coefficient for exponential gain smoothing.
/// `ramp_ms` — 63% settling time in milliseconds; `sample_rate` in Hz.
/// Returns the fraction of (target - current) to add each sample.
pub fn compute_ramp_alpha(ramp_ms: f32, sample_rate: f32) -> f32 {
    if ramp_ms <= 0.0 { return 0.0; }
    let tau_samples = ramp_ms * 0.001 * sample_rate;
    1.0 - (-1.0_f32 / tau_samples).exp()
}

/// Smooth ramp state for zipper-free gain transitions.
/// All fields are stack-allocated — zero heap use in RT path.
#[derive(Debug, Clone, Copy)]
pub struct RampState {
    pub target_linear: f32,
    pub current_linear: f32,
    /// Per-sample blend coefficient: alpha = 1 - exp(-1 / (time_ms * 0.001 * sample_rate))
    /// Larger alpha = faster ramp. Typical: 10ms @ 48kHz → alpha ≈ 0.0021
    pub alpha: f32,
}

impl RampState {
    pub fn new(initial: f32) -> Self {
        Self { target_linear: initial, current_linear: initial, alpha: 0.002 }
    }

    pub fn set_target(&mut self, target_linear: f32) {
        self.target_linear = target_linear;
    }

    #[inline(always)]
    pub fn tick(&mut self) -> f32 {
        self.current_linear += (self.target_linear - self.current_linear) * self.alpha;
        self.current_linear
    }

    #[inline(always)]
    pub fn is_settled(&self) -> bool {
        (self.target_linear - self.current_linear).abs() < 1e-6
    }
}

/// Per-output DSP chain: Gain → HPF → LPF → 5-band EQ → Compressor → Limiter → Delay.
pub struct PerOutputDsp {
    pub eq: ParametricEq,
    pub limiter: BrickWallLimiter,
    pub hpf: ButterworthFilter,
    pub lpf: ButterworthFilter,
    pub compressor: Compressor,
    pub delay: DelayLine,
    pub gain_linear: f32,
    pub gain_ramp: RampState,
    /// Gain reduction from last block in dB (0 = no reduction, negative = limiting active).
    /// Written by `process_block()`, read by metering.
    pub last_gr_db: f32,
}

impl PerOutputDsp {
    pub fn new() -> Self {
        Self {
            eq: ParametricEq::new(),
            limiter: BrickWallLimiter::new(),
            hpf: ButterworthFilter::new(FilterMode::Highpass),
            lpf: ButterworthFilter::new(FilterMode::Lowpass),
            compressor: Compressor::new(),
            delay: DelayLine::new(),
            gain_linear: 1.0,
            gain_ramp: RampState::new(1.0),
            last_gr_db: 0.0,
        }
    }

    /// Sync from full OutputChannelDsp config. RT-safe: pure arithmetic, no allocation.
    pub fn sync_output_dsp(&mut self, cfg: &OutputChannelDsp, sample_rate: f32) {
        self.gain_linear = 10f32.powf(cfg.gain_db / 20.0);
        self.gain_ramp.set_target(self.gain_linear);
        self.hpf.sync(&cfg.hpf, sample_rate);
        self.lpf.sync(&cfg.lpf, sample_rate);
        self.eq.sync(&cfg.eq);
        self.compressor.sync(&cfg.compressor, sample_rate);
        self.limiter.sync(&cfg.limiter, sample_rate);
        self.delay.sync(&cfg.delay, sample_rate);
        // muted is handled by process_block / caller
    }

    /// Legacy sync from separate EQ/limiter configs. Kept for backward compat.
    pub fn sync(&mut self, eq_cfg: &EqConfig, lim_cfg: &LimiterConfig, sample_rate: f32) {
        self.eq.sync(eq_cfg);
        self.limiter.sync(lim_cfg, sample_rate);
    }

    /// Process one block through the full DSP chain. RT-safe: no allocations.
    ///
    /// `muted` — if true, zeroes the buffer and returns immediately.
    #[inline]
    pub fn process_block(&mut self, buf: &mut [f32], muted: bool) {
        if muted {
            for s in buf.iter_mut() { *s = 0.0; }
            return;
        }
        if self.gain_ramp.is_settled() {
            // Fast path: constant gain, no per-sample ramp overhead
            if (self.gain_ramp.current_linear - 1.0).abs() > 1e-6 {
                for s in buf.iter_mut() { *s *= self.gain_ramp.current_linear; }
            }
        } else {
            // Ramp path: smoothly interpolate gain per-sample to eliminate zipper noise
            for s in buf.iter_mut() { *s *= self.gain_ramp.tick(); }
        }
        self.hpf.process_block(buf);
        self.lpf.process_block(buf);
        self.eq.process_block(buf);
        self.compressor.process_block(buf);
        let min_gr = self.limiter.process_block(buf);
        self.last_gr_db = if min_gr <= 0.0 { -120.0 } else { 20.0 * min_gr.log10() };
        self.delay.process_block(buf);
    }
}

impl Default for PerOutputDsp {
    fn default() -> Self { Self::new() }
}

/// Per-input DSP chain: polarity → gain → HPF → LPF → EQ → gate → compressor.
pub struct PerInputDsp {
    pub gain_linear: f32,
    pub gain_ramp: RampState,
    pub invert_polarity: bool,
    pub hpf: ButterworthFilter,
    pub lpf: ButterworthFilter,
    pub eq: ParametricEq,
    pub gate: GateExpander,
    pub compressor: Compressor,
    pub enabled: bool,
}

impl PerInputDsp {
    pub fn new() -> Self {
        Self {
            gain_linear: 1.0,
            gain_ramp: RampState::new(1.0),
            invert_polarity: false,
            hpf: ButterworthFilter::new(FilterMode::Highpass),
            lpf: ButterworthFilter::new(FilterMode::Lowpass),
            eq: ParametricEq::new(),
            gate: GateExpander::new(),
            compressor: Compressor::new(),
            enabled: true,
        }
    }

    /// Sync coefficients from config. RT-safe: pure arithmetic, no allocation.
    pub fn sync(&mut self, cfg: &InputChannelDsp, sample_rate: f32) {
        self.enabled = cfg.enabled; // sync enabled from config
        self.gain_linear = 10f32.powf(cfg.gain_db / 20.0);
        self.gain_ramp.set_target(self.gain_linear);
        self.invert_polarity = cfg.polarity;
        self.hpf.sync(&cfg.hpf, sample_rate);
        self.lpf.sync(&cfg.lpf, sample_rate);
        self.eq.sync(&cfg.eq);
        self.gate.sync(&cfg.gate, sample_rate);
        self.compressor.sync(&cfg.compressor, sample_rate);
    }

    /// Process one block in-place through the full input DSP chain.
    /// RT-safe: no allocations, no locks.
    #[inline]
    pub fn process_block(&mut self, buf: &mut [f32]) {
        if !self.enabled {
            for s in buf.iter_mut() { *s = 0.0; }
            return;
        }
        if self.invert_polarity {
            for s in buf.iter_mut() { *s = -*s; }
        }
        if self.gain_ramp.is_settled() {
            // Fast path: constant gain, no per-sample ramp overhead
            if (self.gain_ramp.current_linear - 1.0).abs() > 1e-6 {
                for s in buf.iter_mut() { *s *= self.gain_ramp.current_linear; }
            }
        } else {
            // Ramp path: smoothly interpolate gain per-sample to eliminate zipper noise
            for s in buf.iter_mut() { *s *= self.gain_ramp.tick(); }
        }
        self.hpf.process_block(buf);
        self.lpf.process_block(buf);
        self.eq.process_block(buf);
        self.gate.process_block(buf);
        self.compressor.process_block(buf);
    }
}

impl Default for PerInputDsp {
    fn default() -> Self { Self::new() }
}

pub const MAX_FRAMES: usize = 1024;
pub const MAX_INPUT_CHANNELS: usize = 64;
pub const MAX_BUSES: usize = 8;


/// Per-bus DSP and summation buffer. Stack-allocated, zero heap use in RT path.
pub struct BusProcessor {
    pub dsp: PerInputDsp,
    pub sum_buf: [f32; MAX_FRAMES],
}

impl BusProcessor {
    pub fn new() -> Self {
        Self {
            dsp: PerInputDsp::new(),
            sum_buf: [0.0f32; MAX_FRAMES],
        }
    }

    pub fn sync(&mut self, cfg: &InputChannelDsp, sample_rate: f32) {
        self.dsp.sync(cfg, sample_rate);
    }

    /// Sum routed post-input-DSP buffers into sum_buf. No heap alloc.
    #[inline]
    pub fn sum_inputs(
        &mut self,
        routed: &[bool],
        post_input_dsp: &[[f32; MAX_FRAMES]],
        nframes: usize,
        n_inputs: usize,
    ) {
        let nf = nframes.min(MAX_FRAMES);
        for s in self.sum_buf[..nf].iter_mut() { *s = 0.0; }
        for (rx_idx, &is_routed) in routed.iter().enumerate().take(n_inputs) {
            if is_routed {
                for i in 0..nf {
                    self.sum_buf[i] += post_input_dsp[rx_idx][i];
                }
            }
        }
    }

    /// Apply bus DSP in-place on sum_buf. No heap alloc.
    #[inline]
    pub fn process(&mut self, nframes: usize, muted: bool) {
        let nf = nframes.min(MAX_FRAMES);
        if muted {
            for s in self.sum_buf[..nf].iter_mut() { *s = 0.0; }
            return;
        }
        self.dsp.process_block(&mut self.sum_buf[..nf]);
    }
}

impl Default for BusProcessor {
    fn default() -> Self { Self::new() }
}

/// Stateful routing matrix processor owning both input and output DSP chains.
///
/// Create once, call `sync()` when config changes, call `process()` per audio block.
pub struct MatrixProcessor {
    pub input_dsp: Vec<PerInputDsp>,
    pub output_dsp: Vec<PerOutputDsp>,
    pub sample_rate: f32,
    /// Pre-allocated scratch buffer for input DSP (heap to avoid 256 KB stack frames).
    scratch: Box<[[f32; MAX_FRAMES]; MAX_INPUT_CHANNELS]>,
    pub bus_processors: Vec<BusProcessor>,
    pub solo_mask: [bool; MAX_INPUT_CHANNELS],
    pub solo_active: bool,
    pub monitor_buf: [f32; MAX_FRAMES],
}

impl MatrixProcessor {
    pub fn new(n_inputs: usize, n_outputs: usize, sample_rate: f32) -> Self {
        Self {
            input_dsp:  (0..n_inputs).map(|_| PerInputDsp::new()).collect(),
            output_dsp: (0..n_outputs).map(|_| PerOutputDsp::new()).collect(),
            sample_rate,
            scratch: Box::new([[0f32; MAX_FRAMES]; MAX_INPUT_CHANNELS]),
            bus_processors: (0..MAX_BUSES).map(|_| BusProcessor::new()).collect(),
            solo_mask: [false; MAX_INPUT_CHANNELS],
            solo_active: false,
            monitor_buf: [0.0f32; MAX_FRAMES],
        }
    }

    /// Sync all DSP state from config. RT-safe: no allocation when vecs already sized.
    pub fn sync(&mut self, cfg: &PatchboxConfig) {
        while self.input_dsp.len() < cfg.input_dsp.len() {
            self.input_dsp.push(PerInputDsp::new());
        }
        for (i, dsp) in self.input_dsp.iter_mut().enumerate() {
            if let Some(cfg_ch) = cfg.input_dsp.get(i) {
                dsp.sync(cfg_ch, self.sample_rate);
            }
        }

        let n_tx = cfg.tx_channels;
        while self.output_dsp.len() < n_tx {
            self.output_dsp.push(PerOutputDsp::new());
        }
        for (i, dsp) in self.output_dsp.iter_mut().enumerate() {
            if let Some(out_cfg) = cfg.output_dsp.get(i) {
                dsp.sync_output_dsp(out_cfg, self.sample_rate);
            }
        }

        // Propagate ramp alpha computed from config gain_ramp_ms
        let alpha = compute_ramp_alpha(cfg.gain_ramp_ms, self.sample_rate);
        for dsp in self.input_dsp.iter_mut() {
            dsp.gain_ramp.alpha = alpha;
        }
        for dsp in self.output_dsp.iter_mut() {
            dsp.gain_ramp.alpha = alpha;
        }
        let n_buses = cfg.internal_buses.len().min(MAX_BUSES);
        for (i, bp) in self.bus_processors.iter_mut().enumerate().take(n_buses) {
            if let Some(bus_cfg) = cfg.internal_buses.get(i) {
                bp.sync(&bus_cfg.dsp, self.sample_rate);
            }
        }

        // Sync solo state
        self.solo_mask = [false; MAX_INPUT_CHANNELS];
        self.solo_active = !cfg.solo_channels.is_empty();
        for &rx in &cfg.solo_channels {
            if rx < MAX_INPUT_CHANNELS {
                self.solo_mask[rx] = true;
            }
        }
    }

    /// Process one audio block: input DSP → matrix routing → output DSP.
    /// RT-safe: no allocations, no locks.
    pub fn process(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        config: &PatchboxConfig,
    ) {
        let nframes = outputs.first().map(|o| o.len()).unwrap_or(0);
        let sample_rate = self.sample_rate;

        // --- Input DSP (processed into temporary scratch slices) ---
        // Scratch is pre-allocated on the struct to avoid a 256 KB stack frame.
        const MAX_FRAMES: usize = 1024;
        let max_inputs = inputs.len().min(MAX_INPUT_CHANNELS);

        let nf = nframes.min(MAX_FRAMES);
        for (i, inp) in inputs.iter().enumerate().take(max_inputs) {
            self.scratch[i][..nf].copy_from_slice(&inp[..nf]);
            if let Some(dsp) = self.input_dsp.get_mut(i) {
                dsp.process_block(&mut self.scratch[i][..nf]);
            }
        }

        // --- PFL monitor mix: tap post-input-DSP, before routing (only when solo active) ---
        if self.solo_active {
            for s in self.monitor_buf[..nf].iter_mut() { *s = 0.0; }
            for rx_idx in 0..max_inputs {
                if self.solo_mask[rx_idx] {
                    for (s_out, &s_in) in self.monitor_buf[..nf].iter_mut()
                        .zip(self.scratch[rx_idx][..nf].iter())
                    {
                        *s_out += s_in;
                    }
                }
            }
            let mon_gain = db_to_linear(config.monitor_volume_db);
            if (mon_gain - 1.0).abs() > 1e-6 {
                for s in self.monitor_buf[..nf].iter_mut() { *s *= mon_gain; }
            }
        }

        // --- Bus stage: sum inputs into each bus, then apply bus DSP ---
        let n_buses = config.internal_buses.len().min(MAX_BUSES);
        for (b, bp) in self.bus_processors.iter_mut().enumerate().take(n_buses) {
            let routed = config.internal_buses.get(b)
                .map(|bc| bc.routing.as_slice())
                .unwrap_or(&[]);
            let muted = config.internal_buses.get(b).map(|bc| bc.muted).unwrap_or(false);
            bp.sum_inputs(routed, &self.scratch[..], nf, max_inputs);
            bp.process(nf, muted);
        }

        for (tx_idx, output) in outputs.iter_mut().enumerate() {
            let out_gain = db_to_linear(
                config.output_gain_db.get(tx_idx).copied().unwrap_or(0.0)
            );

            for s in output.iter_mut() { *s = 0.0; }

            let out_muted = config.output_muted.get(tx_idx).copied().unwrap_or(false)
                || config.output_dsp.get(tx_idx).map(|c| c.muted).unwrap_or(false);
            if out_muted {
                continue;
            }

            for rx_idx in 0..inputs.len() {
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
                    let src = if rx_idx < max_inputs {
                        &self.scratch[rx_idx][..nf]
                    } else {
                        &inputs[rx_idx][..nf]
                    };
                    for (s_out, s_in) in output[..nf].iter_mut().zip(src.iter()) {
                        *s_out += s_in * in_gain;
                    }
                }
            }


            // Sum bus outputs into this TX output
            for b in 0..n_buses {
                let bus_routed = config.bus_matrix
                    .as_ref()
                    .and_then(|bm| bm.get(tx_idx))
                    .and_then(|row| row.get(b))
                    .copied()
                    .unwrap_or(false);
                if bus_routed {
                    if let Some(bp) = self.bus_processors.get(b) {
                        for (s_out, &s_bus) in output[..nf].iter_mut()
                            .zip(bp.sum_buf[..nf].iter())
                        {
                            *s_out += s_bus;
                        }
                    }
                }
            }

            for s in output[..nf].iter_mut() { *s *= out_gain; }

            if let Some(d) = self.output_dsp.get_mut(tx_idx) {
                // sync_output_dsp called from MatrixProcessor::sync(); just process
                d.process_block(&mut output[..nf], false);
            }
        }
    }
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

    for (tx_idx, output) in outputs.iter_mut().enumerate() {
        // Zero output buffer
        for s in output.iter_mut() {
            *s = 0.0;
        }

        // Honour both legacy output_muted and per-channel muted flag
        let out_muted = config.output_muted.get(tx_idx).copied().unwrap_or(false)
            || config.output_dsp.get(tx_idx).map(|c| c.muted).unwrap_or(false);
        if out_muted {
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

        // Apply per-output DSP chain: Gain → HPF → LPF → EQ → Compressor → Limiter → Delay
        // NOTE: sync_output_dsp must be called separately before this function (not in hot path).
        if let Some(d) = dsp.get_mut(tx_idx) {
            d.process_block(&mut output[..nframes], false);
        }
    }
}
