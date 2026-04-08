//! `DanteDevice` — wraps `inferno_aoip::DeviceServer`.
//!
//! With `--features inferno`: creates a real Dante device visible in Dante
//! Controller, starts RX/TX flows.
//!
//! Without the feature: runs a no-op stub (silence in, /dev/null out) so that
//! the rest of the binary compiles and runs in CI / dev without hardware.

use anyhow::Result;
use patchbox_core::control::{AudioParams, MeterFrame};
use std::sync::Arc;
use tokio::sync::RwLock;

/// A running Dante virtual device.
pub struct DanteDevice {
    pub device_name: String,
    pub n_inputs:    usize,
    pub n_outputs:   usize,
}

impl DanteDevice {
    pub fn new(device_name: impl Into<String>, n_inputs: usize, n_outputs: usize) -> Self {
        Self {
            device_name: device_name.into(),
            n_inputs,
            n_outputs,
        }
    }

    /// Start the Dante device.
    ///
    /// With `feature = "inferno"`: spins up `DeviceServer`, registers RX/TX
    /// channels, attaches the DSP bridge as the RX callback, and starts TX.
    ///
    /// Without the feature: logs a warning and returns immediately.
    pub async fn start(&self) -> Result<()> {
        #[cfg(feature = "inferno")]
        {
            self.start_real(None, None).await
        }
        #[cfg(not(feature = "inferno"))]
        {
            tracing::warn!(
                name = %self.device_name,
                inputs  = self.n_inputs,
                outputs = self.n_outputs,
                "Dante stub active — compile with --features inferno for real audio"
            );
            Ok(())
        }
    }

    /// Start with shared state so the RX callback can read the live matrix and
    /// write back live meter readings.
    ///
    /// `params` — same `Arc` as `AppState.params`; the RX callback reads this
    ///            with `try_read()` to avoid blocking the audio thread.
    /// `meters` — same `Arc` as `AppState.meters`; the RX callback writes peak
    ///            dBFS values after each block via `try_write()`.
    pub async fn start_with_params(
        &self,
        params: Arc<RwLock<AudioParams>>,
        meters: Arc<RwLock<MeterFrame>>,
    ) -> Result<()> {
        #[cfg(feature = "inferno")]
        {
            self.start_real(Some(params), Some(meters)).await
        }
        #[cfg(not(feature = "inferno"))]
        {
            let _ = params;
            let _ = meters;
            self.start().await
        }
    }

    #[cfg(feature = "inferno")]
    async fn start_real(
        &self,
        params: Option<Arc<RwLock<AudioParams>>>,
        meters: Option<Arc<RwLock<MeterFrame>>>,
    ) -> Result<()> {
        use inferno_aoip::device_server::{DeviceServer, Settings};

        let short = if self.device_name.len() > 14 {
            &self.device_name[..14]
        } else {
            &self.device_name
        };

        let mut settings = Settings::new(
            &self.device_name,
            short,
            None,
            &Default::default(),
        );
        settings.make_rx_channels(self.n_inputs);
        settings.make_tx_channels(self.n_outputs);

        tracing::info!(
            name = %self.device_name,
            inputs  = self.n_inputs,
            outputs = self.n_outputs,
            "Starting inferno_aoip DeviceServer (waiting for PTP clock…)"
        );

        let mut server = DeviceServer::start(settings).await;

        tracing::info!("inferno_aoip DeviceServer started");

        if let Some(params) = params {
            let n_in  = self.n_inputs;
            let n_out = self.n_outputs;

            server.receive_with_callback(Box::new(move |samples_count, channels| {
                use crate::sample_conv::{i32_to_f32, f32_to_i32};

                // R-11: On first callback invocation, attempt to elevate this thread
                // to SCHED_FIFO RT priority so the DSP hot path is preemption-resistant.
                // Only tries once (thread-local flag).
                #[cfg(target_os = "linux")]
                try_set_rt_priority_once();

                // R-12: No-alloc / no-lock audit notes:
                // - params.try_read() is lock-free on the read path if no writer holds it
                // - Vec allocations below are unavoidable until inferno_aoip exposes
                //   fixed-size buffer API (tracked as D-01 / future sprint)
                // - Future: pre-allocate rx_f32/tx_f32 in a ring buffer outside callback

                let guard = match params.try_read() {
                    Ok(g)  => g,
                    Err(_) => return,
                };

                let actual_in  = channels.len().min(n_in);
                let block      = samples_count;

                let rx_f32: Vec<Vec<f32>> = (0..actual_in)
                    .map(|i| channels[i][..block].iter().map(|&s| i32_to_f32(s)).collect())
                    .collect();

                let mut tx_f32: Vec<Vec<f32>> = (0..n_out)
                    .map(|_| vec![0.0f32; block])
                    .collect();

                let inputs_ref:       Vec<&[f32]>      = rx_f32.iter().map(|v| v.as_slice()).collect();
                let mut outputs_ref:  Vec<&mut [f32]> = tx_f32.iter_mut().map(|v| v.as_mut_slice()).collect();

                let bridge = crate::bridge::AudioBridge::new(block);
                bridge.process(&guard, &inputs_ref, &mut outputs_ref);

                // Compute peak dBFS and write to meters (best-effort, non-blocking)
                if let Some(ref m) = meters {
                    if let Ok(mut mf) = m.try_write() {
                        for (i, ch) in rx_f32.iter().enumerate() {
                            if i < mf.inputs.len() {
                                let peak = ch.iter().fold(0.0f32, |a, &s| a.max(s.abs()));
                                mf.inputs[i] = MeterFrame::lin_to_dbfs(peak);
                            }
                        }
                        for (i, ch) in tx_f32.iter().enumerate() {
                            if i < mf.outputs.len() {
                                let peak = ch.iter().fold(0.0f32, |a, &s| a.max(s.abs()));
                                mf.outputs[i] = MeterFrame::lin_to_dbfs(peak);
                            }
                        }
                    }
                }

                // TODO: wire TX ring buffers (transmit_from_external_buffer — Phase 2)
                let _ = tx_f32.iter().map(|v| v.iter().map(|&s| f32_to_i32(s)));
            })).await;
        } else {
            server.receive_with_callback(Box::new(|_samples_count, _channels| {})).await;
        }

        Ok(())
    }
}

/// R-11: Set SCHED_FIFO priority on the calling thread (Linux only).
/// Uses a thread-local flag so the syscall is made at most once per thread.
/// Requires either `CAP_SYS_NICE` or a `/etc/security/limits.d/` rule
/// granting the `patchbox` user `rtprio 95`.
#[cfg(target_os = "linux")]
#[allow(dead_code)]
fn try_set_rt_priority_once() {
    use std::cell::Cell;
    thread_local! {
        static TRIED: Cell<bool> = const { Cell::new(false) };
    }
    TRIED.with(|tried| {
        if tried.get() { return; }
        tried.set(true);

        // SAFETY: sched_setscheduler is async-signal-safe and only touches
        // the calling thread's scheduling class.
        let ret = unsafe {
            let param = libc::sched_param { sched_priority: 90 };
            libc::sched_setscheduler(0, libc::SCHED_FIFO, &param)
        };
        if ret == 0 {
            tracing::info!("DSP thread elevated to SCHED_FIFO priority 90");
        } else {
            tracing::debug!("SCHED_FIFO not granted (needs CAP_SYS_NICE or rtprio limit): errno={}", unsafe { *libc::__errno_location() });
        }
    });
}

