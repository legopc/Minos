//! `DanteDevice` — wraps `inferno_aoip::DeviceServer`.
//!
//! With `--features inferno`: creates a real Dante device visible in Dante
//! Controller, starts RX/TX flows.
//!
//! Without the feature: runs a no-op stub (silence in, /dev/null out) so that
//! the rest of the binary compiles and runs in CI / dev without hardware.

use anyhow::Result;
use patchbox_core::control::AudioParams;
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
            self.start_real(None).await
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

    /// Start with a shared `AudioParams` reference so the RX callback can read
    /// the live matrix state without locking.
    pub async fn start_with_params(
        &self,
        params: Arc<RwLock<AudioParams>>,
    ) -> Result<()> {
        #[cfg(feature = "inferno")]
        {
            self.start_real(Some(params)).await
        }
        #[cfg(not(feature = "inferno"))]
        {
            let _ = params;
            self.start().await
        }
    }

    #[cfg(feature = "inferno")]
    async fn start_real(&self, params: Option<Arc<RwLock<AudioParams>>>) -> Result<()> {
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

        // If params are available, run the DSP bridge via the RX callback.
        if let Some(params) = params {
            let n_in  = self.n_inputs;
            let n_out = self.n_outputs;

            // The callback is Fn (not FnMut), so we clone the Arc.
            server.receive_with_callback(Box::new(move |samples_count, channels| {
                use crate::sample_conv::{i32_to_f32, f32_to_i32};

                // Try to read params without blocking — skip this block if locked.
                let guard = match params.try_read() {
                    Ok(g)  => g,
                    Err(_) => return,
                };

                let actual_in  = channels.len().min(n_in);
                let block      = samples_count;

                // Normalise RX samples to f32
                let mut rx_f32: Vec<Vec<f32>> = (0..actual_in)
                    .map(|i| channels[i][..block].iter().map(|&s| i32_to_f32(s)).collect())
                    .collect();

                // Output scratch buffers
                let mut tx_f32: Vec<Vec<f32>> = (0..n_out)
                    .map(|_| vec![0.0f32; block])
                    .collect();

                // Build slice refs
                let inputs_ref:  Vec<&[f32]>      = rx_f32.iter().map(|v| v.as_slice()).collect();
                let mut outputs_ref: Vec<&mut [f32]> = tx_f32.iter_mut().map(|v| v.as_mut_slice()).collect();

                let bridge = crate::bridge::AudioBridge::new(block);
                bridge.process(&guard, &inputs_ref, &mut outputs_ref);

                // Note: TX write-back into ring buffers is handled via
                // transmit_from_external_buffer in a future phase. For now,
                // the processed samples are computed but not yet transmitted.
                // TODO: wire TX ring buffers (Phase 1, ticket p1-audio-path)
            })).await;
        } else {
            server.receive_with_callback(Box::new(|_samples_count, _channels| {
                // No-op RX path — Dante device visible but no processing
            })).await;
        }

        Ok(())
    }
}

