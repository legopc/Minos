use clap::Parser;
use patchbox_core::config::PatchboxConfig;
use std::net::SocketAddr;
use std::path::PathBuf;
use crate::state::AppState;
use crate::api::router;

mod api;
mod scenes;
mod state;

#[derive(Parser)]
#[command(name = "patchbox", about = "dante-patchbox v2")]
struct Args {
    #[arg(long, default_value = "config.toml")]
    config: PathBuf,
    #[arg(long)]
    port: Option<u16>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    let config: PatchboxConfig = if args.config.exists() {
        let s = std::fs::read_to_string(&args.config).expect("read config");
        toml::from_str(&s).expect("parse config")
    } else {
        tracing::info!("creating default config at {:?}", args.config);
        let d = PatchboxConfig::default();
        std::fs::write(&args.config, toml::to_string_pretty(&d).unwrap()).unwrap();
        d
    };

    let port = args.port.unwrap_or(config.port);
    tracing::info!("dante-patchbox v2 — {} RX → {} TX zones", config.rx_channels, config.tx_channels);
    tracing::info!("zones:   {:?}", config.zones);
    tracing::info!("sources: {:?}", config.sources);

    let state = AppState::new(config, args.config);

    // Simulated meter task
    let meter_state = state.meters.clone();
    let cfg_ref = state.config.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(50));
        let mut t: f32 = 0.0;
        loop {
            tick.tick().await;
            t += 0.05;
            let cfg = cfg_ref.read().await;
            let mut m = meter_state.write().await;
            m.rx_rms = (0..cfg.rx_channels)
                .map(|i| ((t + i as f32 * 0.7).sin().abs() * 0.4).max(0.0))
                .collect();
            m.tx_rms = (0..cfg.tx_channels)
                .map(|i| {
                    let routed = cfg.matrix[i].iter().any(|&r| r);
                    if routed { ((t + i as f32 * 1.1).sin().abs() * 0.5).max(0.0) } else { 0.0 }
                })
                .collect();
        }
    });

    let app = router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
