//! Stub Dante I/O for testing without real hardware.
//! Generates silence on all RX channels.

pub struct DanteStub {
    pub rx_channels: usize,
    pub tx_channels: usize,
}

impl DanteStub {
    pub fn new(rx: usize, tx: usize) -> Self {
        Self { rx_channels: rx, tx_channels: tx }
    }
}
