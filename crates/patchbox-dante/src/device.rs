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
    /// `dante_rx_active` — same `Arc` as `AppState.dante_rx_active`; bitmask
    ///            of channels that received non-silence (D-04).
    pub async fn start_with_params(
        &self,
        params: Arc<RwLock<AudioParams>>,
        meters: Arc<RwLock<MeterFrame>>,
        dante_rx_active: Arc<std::sync::atomic::AtomicU64>,
    ) -> Result<()> {
        #[cfg(feature = "inferno")]
        {
            self.start_real(Some(params), Some(meters), Some(dante_rx_active)).await
        }
        #[cfg(not(feature = "inferno"))]
        {
            let _ = params;
            let _ = meters;
            let _ = dante_rx_active;
            self.start().await
        }
    }

    #[cfg(feature = "inferno")]
    async fn start_real(
        &self,
        params: Option<Arc<RwLock<AudioParams>>>,
        meters: Option<Arc<RwLock<MeterFrame>>>,
        dante_rx_active: Option<Arc<std::sync::atomic::AtomicU64>>,
    ) -> Result<()> {
        use inferno_aoip::device_server::{AtomicSample, DeviceServer, ExternalBufferParameters, Settings, TransferNotifier};
        use inferno_aoip::device_server::Clock;
        use std::sync::atomic::Ordering as AOrdering;
        use std::sync::atomic::AtomicUsize;

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

        // D-10: Apply DSCP/QoS markings via nftables (best-effort, needs CAP_NET_ADMIN)
        crate::qos::apply_dante_dscp();

        let mut server = DeviceServer::start(settings).await;

        tracing::info!("inferno_aoip DeviceServer started");

        // D-01: TX ring buffer setup
        // Each TX channel gets its own lock-free atomic ring buffer (non-interleaved).
        // RING_SIZE must be a power of 2 and larger than the maximum DSP block size.
        const RING_SIZE: usize = 65536;

        let n_out = self.n_outputs;

        // Shared validity flag — set to false on shutdown to stop TX flows
        let valid = Arc::new(tokio::sync::RwLock::new(true));

        // Per-channel backing memory: Arc keeps alive across callback + transmitter
        let tx_bufs: Vec<Arc<Vec<AtomicSample>>> = (0..n_out)
            .map(|_| Arc::new((0..RING_SIZE).map(|_| AtomicSample::new(0)).collect()))
            .collect();

        // Shared write cursor: updated in the RX callback, read by the TX transmitter
        let current_timestamp = Arc::new(AtomicUsize::new(0));

        // Build ExternalBufferParameters (one per TX channel, stride=1 non-interleaved)
        let tx_params: Vec<ExternalBufferParameters<i32>> = tx_bufs
            .iter()
            .map(|buf| unsafe {
                ExternalBufferParameters::new(
                    buf.as_ptr(),
                    RING_SIZE,
                    1,
                    Arc::clone(&valid),
                    None,
                )
            })
            .collect();

        // Oneshot to signal the TX transmitter when the first block arrives
        let (start_tx, start_rx) = tokio::sync::oneshot::channel::<Clock>();

        // Set up TX — this spawns background tasks and returns immediately.
        server
            .transmit_from_external_buffer(
                tx_params,
                start_rx,
                Arc::clone(&current_timestamp),
                None,
            )
            .await;

        tracing::info!("TX transmitter armed, waiting for first RX block");

        if let Some(params) = params {
            let n_in = self.n_inputs;

            // Clone Arcs for the callback closure
            let tx_bufs_cb       = tx_bufs.clone();
            let current_ts_cb    = Arc::clone(&current_timestamp);
            let rx_active_cb     = dante_rx_active;
            let mut start_tx_opt: Option<tokio::sync::oneshot::Sender<Clock>> = Some(start_tx);

            server.receive_with_callback(Box::new(move |samples_count, channels| {
                use crate::sample_conv::{i32_to_f32, f32_to_i32};

                // R-11: Elevate DSP thread to SCHED_FIFO once per thread.
                #[cfg(target_os = "linux")]
                try_set_rt_priority_once();

                let guard = match params.try_read() {
                    Ok(g)  => g,
                    Err(_) => return,
                };

                let actual_in = channels.len().min(n_in);
                let block     = samples_count;

                let rx_f32: Vec<Vec<f32>> = (0..actual_in)
                    .map(|i| channels[i][..block].iter().map(|&s| i32_to_f32(s)).collect())
                    .collect();

                let mut tx_f32: Vec<Vec<f32>> = (0..n_out)
                    .map(|_| vec![0.0f32; block])
                    .collect();

                let inputs_ref:      Vec<&[f32]>      = rx_f32.iter().map(|v| v.as_slice()).collect();
                let mut outputs_ref: Vec<&mut [f32]> = tx_f32.iter_mut().map(|v| v.as_mut_slice()).collect();

                let bridge = crate::bridge::AudioBridge::new(block);
                bridge.process(&guard, &inputs_ref, &mut outputs_ref);

                // Compute peak dBFS for meters (best-effort, non-blocking)
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

                // D-04: Update RX activity bitmask (non-blocking lock-free write).
                // A channel is "active" if it received any non-zero sample this block.
                if let Some(ref rx_active) = rx_active_cb {
                    let mut mask: u64 = 0;
                    for (i, ch) in rx_f32.iter().enumerate().take(64) {
                        if ch.iter().any(|&s| s != 0.0) {
                            mask |= 1u64 << i;
                        }
                    }
                    rx_active.store(mask, AOrdering::Relaxed);
                }

                // D-01: Write processed samples into TX atomic ring buffers.
                // The ring buffer position wraps with % RING_SIZE.
                let write_pos = current_ts_cb.load(AOrdering::Acquire);
                for (o, ch) in tx_f32.iter().enumerate() {
                    if o >= tx_bufs_cb.len() { break; }
                    let buf = &tx_bufs_cb[o];
                    for (i, &s) in ch[..block].iter().enumerate() {
                        let idx = (write_pos.wrapping_add(i)) % RING_SIZE;
                        buf[idx].store(f32_to_i32(s), AOrdering::Relaxed);
                    }
                }
                // Advance the shared write cursor so the TX transmitter knows
                // up to which sample position it can read.
                let new_pos = write_pos.wrapping_add(block);
                current_ts_cb.store(new_pos, AOrdering::Release);

                // Signal TX transmitter with PTP start position on very first block.
                if let Some(tx) = start_tx_opt.take() {
                    if let Err(e) = tx.send(write_pos as Clock) {
                        tracing::warn!("Failed to send TX start time: {e}");
                    } else {
                        tracing::info!(pos = write_pos, "TX transmitter started at position");
                    }
                }
            })).await;
        } else {
            // No DSP params — run minimal TX (silence) + empty RX callback
            let current_ts_cb = Arc::clone(&current_timestamp);
            let _ = start_tx.send(0 as Clock);
            server.receive_with_callback(Box::new(move |samples_count, _channels| {
                let pos = current_ts_cb.load(AOrdering::Relaxed);
                current_ts_cb.store(pos.wrapping_add(samples_count), AOrdering::Release);
            })).await;
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

