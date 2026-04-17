//! Dugan gain-sharing automixer with optional NOM gating.
//!
//! The Dugan algorithm keeps the sum of all channel gains in a group constant at 1.0.
//! Each channel's gain is proportional to its signal level:
//!   g_i = (w_i * env_i) / sum(w_j * env_j)
//! When all channels are quiet, gains are equal (1/N each).
//! This is RT-safe: no allocation in process_block().

use crate::config::{AutomixerGroupConfig, PatchboxConfig};
use crate::matrix::MAX_FRAMES;

pub const MAX_AM_GROUPS: usize = 8;

/// One automixer group with all its RT state.
struct AutomixerGroupState {
    group_id: String,
    enabled: bool,
    off_att_linear: f32,
    hold_samples: f32,
    last_mic_hold: bool,
    gating_enabled: bool,
    /// Channel rx_indices and their weights (parallel vecs, always same length)
    member_rx: Vec<usize>,
    member_weights: Vec<f32>,
    /// Exponential envelope followers, one per member.
    envelopes: Vec<f32>,
    /// Smoothed Dugan gains, one per member (for metering display).
    pub dugan_gains: Vec<f32>,
    /// Countdown in samples for each member's gate hold timer.
    hold_counters: Vec<f32>,
}

impl AutomixerGroupState {
    fn new() -> Self {
        Self {
            group_id: String::new(),
            enabled: false,
            off_att_linear: 0.0,
            hold_samples: 0.0,
            last_mic_hold: true,
            gating_enabled: false,
            member_rx: Vec::new(),
            member_weights: Vec::new(),
            envelopes: Vec::new(),
            dugan_gains: Vec::new(),
            hold_counters: Vec::new(),
        }
    }

    /// Sync group state from config. Called outside RT (may allocate).
    fn sync(
        &mut self,
        cfg: &AutomixerGroupConfig,
        channel_members: &[(usize, f32)],
        sample_rate: f32,
    ) {
        self.group_id = cfg.id.clone();
        self.enabled = cfg.enabled;
        self.off_att_linear = db_to_linear(cfg.off_attenuation_db);
        self.hold_samples = cfg.hold_ms * 0.001 * sample_rate;
        self.last_mic_hold = cfg.last_mic_hold;
        self.gating_enabled = cfg.gating_enabled;

        let n = channel_members.len();
        self.member_rx = channel_members.iter().map(|&(rx, _)| rx).collect();
        self.member_weights = channel_members.iter().map(|&(_, w)| w).collect();

        // Preserve existing envelope state on re-sync; resize if membership changed.
        self.envelopes.resize(n, 0.0);
        self.dugan_gains.resize(n, 1.0 / n.max(1) as f32);
        self.hold_counters.resize(n, 0.0);
    }

    /// Apply Dugan gain-sharing (and optional gating) to scratch buffers.
    ///
    /// `scratch`: post-input-DSP audio, indexed by rx_idx.
    /// `nf`: number of valid frames in each scratch channel.
    #[inline]
    pub fn process_block(
        &mut self,
        scratch: &mut [[f32; MAX_FRAMES]],
        nf: usize,
        gate_threshold_linear: f32,
    ) {
        if !self.enabled || self.member_rx.is_empty() {
            return;
        }
        let n = self.member_rx.len();

        // --- 1. Measure block RMS per member and update envelope followers ---
        let inv_nf = 1.0 / nf as f32;
        // Attack: 10ms time constant → fast follow rising signals
        const ATTACK_TC_MS: f32 = 10.0;
        // Release: 100ms time constant → slow release for smooth gains
        const RELEASE_TC_MS: f32 = 100.0;
        // Approximation: per-block smoothing constant (block is ~1ms at 48kHz/48samp)
        let block_ms = nf as f32 * (1000.0 / 48000.0);
        let att_alpha = 1.0 - (-block_ms / ATTACK_TC_MS).exp();
        let rel_alpha = 1.0 - (-block_ms / RELEASE_TC_MS).exp();

        let mut weighted_envs = [0f32; 64]; // stack, MAX 64 members
        let mut weighted_sum = 0.0f32;

        for (slot, (&rx_idx, &weight)) in self
            .member_rx
            .iter()
            .zip(self.member_weights.iter())
            .enumerate()
        {
            // Block RMS
            let sq: f32 = scratch[rx_idx][..nf].iter().map(|s| s * s).sum::<f32>() * inv_nf;
            let block_rms = sq.sqrt();

            // Envelope follower
            let env = &mut self.envelopes[slot];
            let alpha = if block_rms > *env {
                att_alpha
            } else {
                rel_alpha
            };
            *env += (block_rms - *env) * alpha;

            let we = *env * weight;
            weighted_envs[slot] = we;
            weighted_sum += we;
        }

        // --- 2. Compute Dugan gains ---
        if weighted_sum < 1e-12 {
            // All channels silent → equal gain
            let equal = 1.0 / n as f32;
            for slot in 0..n {
                self.dugan_gains[slot] = equal;
            }
        } else {
            for slot in 0..n {
                self.dugan_gains[slot] = weighted_envs[slot] / weighted_sum;
            }
        }

        // --- 3. Gating (optional) ---
        // Gate channels whose envelope is below threshold; keep last-active if last_mic_hold.
        if self.gating_enabled {
            let mut n_open: usize = 0;
            let mut last_open: Option<usize> = None;
            let mut loudest_slot: usize = 0;
            let mut loudest_env: f32 = 0.0;

            for (slot, env) in self.envelopes.iter().enumerate().take(n) {
                if *env > loudest_env {
                    loudest_env = *env;
                    loudest_slot = slot;
                }
                if *env > gate_threshold_linear {
                    n_open += 1;
                    last_open = Some(slot);
                    self.hold_counters[slot] = self.hold_samples;
                } else if self.hold_counters[slot] > 0.0 {
                    self.hold_counters[slot] -= nf as f32;
                    n_open += 1;
                    last_open = Some(slot);
                }
            }

            // If last_mic_hold and no channel open, force loudest channel open
            if n_open == 0 && self.last_mic_hold {
                last_open = Some(loudest_slot);
            }

            // Apply gate: override Dugan gain for gated channels
            for slot in 0..n {
                let is_open = self.envelopes[slot] > gate_threshold_linear
                    || self.hold_counters[slot] > 0.0
                    || (self.last_mic_hold && last_open == Some(slot));
                if !is_open {
                    self.dugan_gains[slot] = self.off_att_linear;
                }
            }
        }

        // --- 4. Apply computed gains ---
        for (slot, &rx_idx) in self.member_rx.iter().enumerate() {
            let g = self.dugan_gains[slot];
            for s in scratch[rx_idx][..nf].iter_mut() {
                *s *= g;
            }
        }
    }
}

/// Top-level automixer processor. One per MatrixProcessor.
pub struct AutomixerProcessor {
    groups: Vec<AutomixerGroupState>,
    /// gate_threshold_linear[group_idx]
    gate_thresholds: Vec<f32>,
}

impl AutomixerProcessor {
    pub fn new() -> Self {
        Self {
            groups: Vec::new(),
            gate_thresholds: Vec::new(),
        }
    }

    /// Sync from config. Called outside RT; may allocate.
    pub fn sync(&mut self, cfg: &PatchboxConfig) {
        let n_groups = cfg.automixer_groups.len().min(MAX_AM_GROUPS);

        // Resize if needed
        while self.groups.len() < n_groups {
            self.groups.push(AutomixerGroupState::new());
        }
        self.groups.truncate(n_groups);
        self.gate_thresholds.resize(n_groups, 0.0);

        for (gi, group_cfg) in cfg.automixer_groups.iter().take(n_groups).enumerate() {
            // Collect channels in this group
            let members: Vec<(usize, f32)> = cfg
                .input_dsp
                .iter()
                .enumerate()
                .filter_map(|(rx_idx, dsp)| {
                    if dsp.automixer.group_id.as_deref() == Some(group_cfg.id.as_str()) {
                        Some((rx_idx, dsp.automixer.weight.max(0.01)))
                    } else {
                        None
                    }
                })
                .collect();

            self.groups[gi].sync(group_cfg, &members, cfg.gain_ramp_ms.max(1.0) * 48.0);
            self.gate_thresholds[gi] = db_to_linear(group_cfg.gate_threshold_db);
        }
    }

    /// Apply automixer gain to scratch buffers.
    /// Must be called AFTER all input DSP is applied, BEFORE routing.
    #[inline]
    pub fn process_block(&mut self, scratch: &mut [[f32; MAX_FRAMES]], nf: usize) {
        for (gi, group) in self.groups.iter_mut().enumerate() {
            let thresh = self.gate_thresholds.get(gi).copied().unwrap_or(0.0);
            group.process_block(scratch, nf, thresh);
        }
    }

    /// Returns current Dugan gains for all groups (for metering / UI).
    /// Format: Vec of (group_id, Vec<(rx_idx, gain)>)
    pub fn gains_snapshot(&self) -> Vec<(String, Vec<(usize, f32)>)> {
        self.groups
            .iter()
            .map(|g| {
                let pairs = g
                    .member_rx
                    .iter()
                    .zip(g.dugan_gains.iter())
                    .map(|(&rx, &gain)| (rx, gain))
                    .collect();
                (g.group_id.clone(), pairs)
            })
            .collect()
    }
}

impl Default for AutomixerProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[inline]
fn db_to_linear(db: f32) -> f32 {
    10.0f32.powf(db / 20.0)
}
