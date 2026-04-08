//! DanteDevice stub — will be replaced with inferno_aoip integration.
//!
//! The stub generates silence on RX and discards TX, allowing the audio
//! pipeline to be built and tested before the Dante integration is finalised.

use anyhow::Result;

pub struct DanteDevice {
    pub n_inputs:  usize,
    pub n_outputs: usize,
    pub device_name: String,
}

impl DanteDevice {
    pub fn new(device_name: impl Into<String>, n_inputs: usize, n_outputs: usize) -> Self {
        Self {
            device_name: device_name.into(),
            n_inputs,
            n_outputs,
        }
    }

    /// Start the device. Returns an error if inferno_aoip is unavailable.
    pub async fn start(&self) -> Result<()> {
        tracing::info!(
            name = %self.device_name,
            inputs  = self.n_inputs,
            outputs = self.n_outputs,
            "DanteDevice stub started (inferno_aoip not yet integrated)"
        );
        // TODO(A1): replace with inferno_aoip::Device::new(...).start()
        Ok(())
    }
}
