use clap::Parser;
use patchbox_core::config::PatchboxConfig;
use std::net::SocketAddr;
use std::path::PathBuf;
use crate::state::AppState;
use crate::api::router;

mod api;
mod state;

#[derive(Parser)]
#[command(name = "patchbox", about = "dante-patchbox v2 — Dante AoIP patchbay")]
struct Args {
    /// Path to config file
    #[arg(long, default_value = "config.toml")]
    config: PathBuf,
    /// Override listen port
    #[arg(long)]
    port: Option<u16>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    // Load or create default config
    let config = if args.config.exists() {
        let content = std::fs::read_to_string(&args.config)
            .expect("failed to read config file");
        toml::from_str(&content).expect("failed to parse config file")
    } else {
        tracing::info!("no config file found, creating default at {:?}", args.config);
        let default = PatchboxConfig::default();
        let toml_str = toml::to_string_pretty(&default).expect("serialize failed");
        std::fs::write(&args.config, &toml_str).expect("failed to write default config");
        default
    };

    let port = args.port.unwrap_or(config.port);

    tracing::info!(
        "dante-patchbox v2 — {} RX sources → {} TX zones",
        config.rx_channels,
        config.tx_channels
    );
    tracing::info!("zones: {:?}", config.zones);
    tracing::info!("sources: {:?}", config.sources);

    let state = AppState::new(config, args.config);
    let app = router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.expect("failed to bind");
    axum::serve(listener, app).await.expect("server error");
}
