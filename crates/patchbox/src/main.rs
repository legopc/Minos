//! dante-patchbox v2 — entry point

use patchbox_core::config::PatchboxConfig;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let config = PatchboxConfig::default();
    tracing::info!(
        "dante-patchbox v2 starting: {} RX → {} TX, port {}",
        config.rx_channels,
        config.tx_channels,
        config.port
    );

    // TODO Phase 0: wire up axum server, Dante device, routing matrix
    tracing::info!("Scaffold ready — implementation in progress");
}
