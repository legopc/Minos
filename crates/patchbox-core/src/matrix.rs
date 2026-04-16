//! Routing matrix — routes N inputs to M outputs with gain staging

use crate::config::{EqConfig, InputChannelDsp, LimiterConfig, OutputChannelDsp, PatchboxConfig, VcaGroupType};
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
    /// TPDF dither: 0 = disabled, else amplitude = 0.5 LSB at given bit depth.
    pub dither_amp: f32,
    /// Xorshift32 RNG state for TPDF dither. Never zero.
    dither_rng: u32,
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
            dither_amp: 0.0,
            dither_rng: 0xDEAD_BEEF,
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
        // TPDF dither amplitude: 0.5 LSB at cfg.dither_bits depth (normalised -1..1)
        self.dither_amp = if cfg.dither_bits > 0 {
            0.5 / (1u32 << (cfg.dither_bits.min(31) - 1)) as f32
        } else {
            0.0
        };
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

        // TPDF dither: two independent white noise sources minus each other = triangular PDF
        if self.dither_amp > 0.0 {
            let amp = self.dither_amp;
            for s in buf.iter_mut() {
                // Xorshift32 — allocation-free, RT-safe
                self.dither_rng ^= self.dither_rng << 13;
                self.dither_rng ^= self.dither_rng >> 17;
                self.dither_rng ^= self.dither_rng << 5;
                let r1 = (self.dither_rng as f32) / (u32::MAX as f32) * 2.0 - 1.0;
                self.dither_rng ^= self.dither_rng << 13;
                self.dither_rng ^= self.dither_rng >> 17;
                self.dither_rng ^= self.dither_rng << 5;
                let r2 = (self.dither_rng as f32) / (u32::MAX as f32) * 2.0 - 1.0;
                *s += (r1 - r2) * amp;
            }
        }
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
    // DC blocker state: 1st-order HPF at ~2 Hz, always on
    dc_x1: f32,
    dc_y1: f32,
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
            dc_x1: 0.0,
            dc_y1: 0.0,
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
        // DC blocker (always on): y[n] = x[n] - x[n-1] + R*y[n-1], R ≈ 0.9999 (~2 Hz)
        const DC_R: f32 = 0.9999;
        for s in buf.iter_mut() {
            let y = *s - self.dc_x1 + DC_R * self.dc_y1;
            self.dc_x1 = *s;
            self.dc_y1 = y;
            *s = y;
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
pub const MAX_VCA_GROUPS: usize = 16;
pub const MAX_GENERATORS: usize = 8;


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

    /// Sum routed post-input-DSP buffers into sum_buf, applying per-input gain. No heap alloc.
    #[inline]
    pub fn sum_inputs(
        &mut self,
        routed: &[bool],
        routing_gain: &[f32],
        post_input_dsp: &[[f32; MAX_FRAMES]],
        nframes: usize,
        n_inputs: usize,
    ) {
        let nf = nframes.min(MAX_FRAMES);
        for s in self.sum_buf[..nf].iter_mut() { *s = 0.0; }
        for (rx_idx, &is_routed) in routed.iter().enumerate().take(n_inputs) {
            if is_routed {
                let gain = db_to_linear(*routing_gain.get(rx_idx).unwrap_or(&0.0));
                for i in 0..nf {
                    self.sum_buf[i] += post_input_dsp[rx_idx][i] * gain;
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

/// Per-generator oscillator/noise state (stack-allocated)
pub struct GeneratorState {
    pub phase: f32,     // sine oscillator phase
    pub rng: u64,       // xorshift64 state for white/pink noise
    pub b: [f32; 7],    // pink noise IIR state (Paul Kellet filter)
    pub gen_type: crate::config::SignalGenType,
    pub freq_hz: f32,
    pub enabled: bool,
}

impl GeneratorState {
    fn new() -> Self {
        Self {
            phase: 0.0,
            rng: 0x123456789ABCDEF1u64,
            b: [0.0f32; 7],
            gen_type: crate::config::SignalGenType::Sine,
            freq_hz: 1000.0,
            enabled: false,
        }
    }
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
    /// Per-crosspoint gain ramps [tx_idx][rx_idx]. Heap-allocated to avoid 48KB stack frame.
    pub xp_ramps: Box<[[RampState; MAX_INPUT_CHANNELS]; MAX_INPUT_CHANNELS]>,
    /// Per-VCA-group gain ramps.
    pub vca_ramps: [RampState; MAX_VCA_GROUPS],
    /// vca_input_map[rx_idx] = Some(vca_group_idx) if that input is in a VCA input group.
    pub vca_input_map: [Option<usize>; MAX_INPUT_CHANNELS],
    /// vca_output_map[tx_idx] = Some(vca_group_idx) if that output is in a VCA output group.
    pub vca_output_map: [Option<usize>; MAX_INPUT_CHANNELS],
    /// Per-generator oscillator state
    pub gen_states: Vec<GeneratorState>,
    /// Pre-allocated scratch buffers for generator audio [gen_idx][sample]
    pub gen_scratch: Box<[[f32; MAX_FRAMES]; MAX_GENERATORS]>,
    /// gen_gains_linear[gen_idx][tx_idx] — converted from generator_bus_matrix dB in sync()
    pub gen_gains_linear: Vec<Vec<f32>>,
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
            xp_ramps: Box::new([[RampState::new(0.0); MAX_INPUT_CHANNELS]; MAX_INPUT_CHANNELS]),
            vca_ramps: std::array::from_fn(|_| RampState::new(1.0)),
            vca_input_map: [None; MAX_INPUT_CHANNELS],
            vca_output_map: [None; MAX_INPUT_CHANNELS],
            gen_states: Vec::new(),
            gen_scratch: Box::new([[0f32; MAX_FRAMES]; MAX_GENERATORS]),
            gen_gains_linear: Vec::new(),
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

        // --- Per-crosspoint ramp sync ---
        let xp_alpha = if cfg.xp_ramp_ms > 0.0 {
            compute_ramp_alpha(cfg.xp_ramp_ms, self.sample_rate)
        } else {
            compute_ramp_alpha(cfg.gain_ramp_ms, self.sample_rate)
        };
        for tx_idx in 0..cfg.tx_channels.min(MAX_INPUT_CHANNELS) {
            for rx_idx in 0..cfg.rx_channels.min(MAX_INPUT_CHANNELS) {
                let enabled = cfg.matrix.get(tx_idx).and_then(|r| r.get(rx_idx)).copied().unwrap_or(false);
                let gain_db = cfg.matrix_gain_db.get(tx_idx).and_then(|r| r.get(rx_idx)).copied().unwrap_or(0.0);
                let target_linear = if enabled { db_to_linear(gain_db) } else { 0.0 };
                self.xp_ramps[tx_idx][rx_idx].set_target(target_linear);
                self.xp_ramps[tx_idx][rx_idx].alpha = xp_alpha;
            }
        }

        // --- VCA group sync ---
        self.vca_input_map = [None; MAX_INPUT_CHANNELS];
        self.vca_output_map = [None; MAX_INPUT_CHANNELS];
        for (vca_idx, vca) in cfg.vca_groups.iter().enumerate().take(MAX_VCA_GROUPS) {
            let target = if vca.muted { 0.0 } else { db_to_linear(vca.gain_db) };
            self.vca_ramps[vca_idx].set_target(target);
            self.vca_ramps[vca_idx].alpha = compute_ramp_alpha(cfg.gain_ramp_ms, self.sample_rate);
            for member_id in &vca.members {
                if let Some(idx) = parse_channel_id(member_id) {
                    match vca.group_type {
                        VcaGroupType::Input  => { if idx < MAX_INPUT_CHANNELS { self.vca_input_map[idx]  = Some(vca_idx); } }
                        VcaGroupType::Output => { if idx < MAX_INPUT_CHANNELS { self.vca_output_map[idx] = Some(vca_idx); } }
                    }
                }
            }
        }

        // Sync generator states
        let n_gens = cfg.signal_generators.len().min(MAX_GENERATORS);
        while self.gen_states.len() < n_gens {
            self.gen_states.push(GeneratorState::new());
        }
        for (i, gstate) in self.gen_states.iter_mut().enumerate().take(n_gens) {
            if let Some(gcfg) = cfg.signal_generators.get(i) {
                gstate.gen_type = gcfg.gen_type;
                gstate.freq_hz = gcfg.freq_hz;
                gstate.enabled = gcfg.enabled;
            }
        }
        // Sync generator→TX linear gains
        while self.gen_gains_linear.len() < n_gens {
            self.gen_gains_linear.push(vec![0.0f32; cfg.tx_channels]);
        }
        for (i, gains) in self.gen_gains_linear.iter_mut().enumerate().take(n_gens) {
            let n_tx = cfg.tx_channels;
            gains.resize(n_tx.max(gains.len()), 0.0);
            for tx_idx in 0..n_tx {
                let db = cfg.generator_bus_matrix.get(i)
                    .and_then(|row| row.get(tx_idx))
                    .copied()
                    .unwrap_or(f32::NEG_INFINITY);
                gains[tx_idx] = if db.is_finite() { db_to_linear(db) } else { 0.0 };
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

        // --- PFL monitor mix: tap pre-input-DSP (raw Dante signal) ---
        // Tap BEFORE input_dsp so that channel trim/gain does not drive the monitor into
        // clipping. The monitor level is controlled solely by monitor_volume_db.
        // Outputs are post-DSP (trim applied) and protected by the output limiter;
        // the monitor path has no limiter, so a pre-DSP tap is the safe choice.
        if self.solo_active {
            for s in self.monitor_buf[..nf].iter_mut() { *s = 0.0; }
            for rx_idx in 0..max_inputs {
                if self.solo_mask[rx_idx] {
                    for (s_out, &s_in) in self.monitor_buf[..nf].iter_mut()
                        .zip(inputs[rx_idx][..nf].iter())
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

        // Tick all VCA ramps once per block
        let mut vca_gains = [1.0f32; MAX_VCA_GROUPS];
        for i in 0..config.vca_groups.len().min(MAX_VCA_GROUPS) {
            vca_gains[i] = self.vca_ramps[i].tick();
        }

        for (i, inp) in inputs.iter().enumerate().take(max_inputs) {
            self.scratch[i][..nf].copy_from_slice(&inp[..nf]);
            if let Some(dsp) = self.input_dsp.get_mut(i) {
                dsp.process_block(&mut self.scratch[i][..nf]);
            }
            // Apply input VCA multiplier after input DSP
            if let Some(vca_idx) = self.vca_input_map[i] {
                let vca_gain = vca_gains[vca_idx];
                if (vca_gain - 1.0).abs() > 1e-6 {
                    for s in self.scratch[i][..nf].iter_mut() { *s *= vca_gain; }
                }
            }
        }

        // --- Bus stage: sum inputs into each bus, then apply bus DSP ---
        let n_buses = config.internal_buses.len().min(MAX_BUSES);
        for (b, bp) in self.bus_processors.iter_mut().enumerate().take(n_buses) {
            let routed = config.internal_buses.get(b)
                .map(|bc| bc.routing.as_slice())
                .unwrap_or(&[]);
            let routing_gain = config.internal_buses.get(b)
                .map(|bc| bc.routing_gain.as_slice())
                .unwrap_or(&[]);
            let muted = config.internal_buses.get(b).map(|bc| bc.muted).unwrap_or(false);
            bp.sum_inputs(routed, routing_gain, &self.scratch[..], nf, max_inputs);
            bp.process(nf, muted);
        }

        // --- Generate signal generator buffers (once, before output mix loop) ---
        let n_gens = config.signal_generators.len().min(self.gen_states.len()).min(MAX_GENERATORS);
        for gen_idx in 0..n_gens {
            let gstate = &mut self.gen_states[gen_idx];
            let buf = &mut self.gen_scratch[gen_idx];
            if !gstate.enabled {
                for s in buf[..nf].iter_mut() { *s = 0.0; }
                continue;
            }
            let level_db = config.signal_generators[gen_idx].level_db;
            if !level_db.is_finite() {
                for s in buf[..nf].iter_mut() { *s = 0.0; }
                continue;
            }
            let level = db_to_linear(level_db);
            match gstate.gen_type {
                crate::config::SignalGenType::Sine => {
                    let phase_inc = 2.0 * std::f32::consts::PI * gstate.freq_hz / sample_rate;
                    for s in buf[..nf].iter_mut() {
                        *s = gstate.phase.sin() * level;
                        gstate.phase += phase_inc;
                        if gstate.phase > std::f32::consts::TAU {
                            gstate.phase -= std::f32::consts::TAU;
                        }
                    }
                }
                crate::config::SignalGenType::WhiteNoise => {
                    for s in buf[..nf].iter_mut() {
                        let mut x = gstate.rng;
                        x ^= x << 13;
                        x ^= x >> 7;
                        x ^= x << 17;
                        gstate.rng = x;
                        *s = (x as i64 as f32) / (i64::MAX as f32) * level;
                    }
                }
                crate::config::SignalGenType::PinkNoise => {
                    let b = &mut gstate.b;
                    for s in buf[..nf].iter_mut() {
                        let mut x = gstate.rng;
                        x ^= x << 13;
                        x ^= x >> 7;
                        x ^= x << 17;
                        gstate.rng = x;
                        let white = (x as i64 as f32) / (i64::MAX as f32);
                        b[0] = 0.99886 * b[0] + white * 0.0555179;
                        b[1] = 0.99332 * b[1] + white * 0.0750759;
                        b[2] = 0.96900 * b[2] + white * 0.1538520;
                        b[3] = 0.86650 * b[3] + white * 0.3104856;
                        b[4] = 0.55000 * b[4] + white * 0.5329522;
                        b[5] = -0.7616  * b[5] - white * 0.0168980;
                        let pink = b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+white*0.5362;
                        b[6] = white * 0.115926;
                        *s = pink * 0.11 * level;
                    }
                }
            }
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
                // Tick xp_ramp once per block (block-level approximation for crossfade)
                let xp_linear = if tx_idx < MAX_INPUT_CHANNELS && rx_idx < MAX_INPUT_CHANNELS {
                    self.xp_ramps[tx_idx][rx_idx].tick()
                } else {
                    0.0
                };
                if xp_linear < 1e-6 { continue; }

                let in_gain = db_to_linear(
                    config.input_gain_db.get(rx_idx).copied().unwrap_or(0.0)
                ) * xp_linear;
                let src = if rx_idx < max_inputs {
                    &self.scratch[rx_idx][..nf]
                } else {
                    &inputs[rx_idx][..nf]
                };
                for (s_out, s_in) in output[..nf].iter_mut().zip(src.iter()) {
                    *s_out += s_in * in_gain;
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

            // Mix generator signals into this TX output
            for gen_idx in 0..n_gens {
                let g = self.gen_gains_linear.get(gen_idx)
                    .and_then(|row| row.get(tx_idx))
                    .copied()
                    .unwrap_or(0.0);
                if g < 1e-6 { continue; }
                let gen_buf = &self.gen_scratch[gen_idx];
                for (s_out, &s_gen) in output[..nf].iter_mut().zip(gen_buf[..nf].iter()) {
                    *s_out += s_gen * g;
                }
            }

            for s in output[..nf].iter_mut() { *s *= out_gain; }

            // Apply output VCA multiplier before output DSP
            if let Some(vca_idx) = self.vca_output_map[tx_idx] {
                let vca_gain = vca_gains[vca_idx];
                if (vca_gain - 1.0).abs() > 1e-6 {
                    for s in output[..nf].iter_mut() { *s *= vca_gain; }
                }
            }

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

/// Parse "rx_3" → Some(3), "tx_7" → Some(7), anything else → None
fn parse_channel_id(id: &str) -> Option<usize> {
    id.strip_prefix("rx_").or_else(|| id.strip_prefix("tx_"))
       .and_then(|n| n.parse().ok())
}
