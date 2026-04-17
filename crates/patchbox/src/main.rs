use crate::api::router;
use crate::state::AppState;
use clap::Parser;
use patchbox_core::config::PatchboxConfig;
use std::net::SocketAddr;
use std::path::PathBuf;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod api;
mod auth_api;
mod jwt;
mod pam_auth;
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
    let env_filter = EnvFilter::try_from_default_env()
        .or_else(|_| EnvFilter::try_new("info"))
        .unwrap();

    let log_format = std::env::var("PATCHBOX_LOG_FORMAT").unwrap_or_else(|_| "pretty".to_string());

    match log_format.as_str() {
        "json" => {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(fmt::layer().json())
                .init();
        }
        _ => {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(fmt::layer().pretty())
                .init();
        }
    }

    let args = Args::parse();

    let config: PatchboxConfig = if args.config.exists() {
        let s = std::fs::read_to_string(&args.config).expect("read config");
        let mut c: PatchboxConfig = toml::from_str(&s).expect("parse config");
        c.normalize();
        // After normalize(), validate before use
        if let Err(e) = c.validate() {
            tracing::error!(error = %e, path = %args.config.display(),
                "Config validation failed — falling back to defaults. Check your config.toml.");
            c = PatchboxConfig::default();
            c.normalize();
        }
        c
    } else {
        tracing::info!("creating default config at {:?}", args.config);
        let d = PatchboxConfig::default();
        std::fs::write(&args.config, toml::to_string_pretty(&d).unwrap()).unwrap();
        d
    };

    let port = args.port.unwrap_or(config.port);

    let bind_addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        bind_address = %bind_addr,
        device = %config.dante_name,
        rx_channels = config.rx_channels,
        tx_channels = config.tx_channels,
        "dante-patchbox starting"
    );

    let state = AppState::new(config.clone(), args.config);

    // Startup validation: verify config is writable
    state
        .persist()
        .await
        .expect("startup config write check failed — check permissions on config file");
    tracing::info!("config writability check passed");

    // Graceful shutdown: flush config on SIGINT/SIGTERM
    let state_for_shutdown = state.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        tracing::info!("shutting down — persisting config");
        let _ = state_for_shutdown.persist().await;
        std::process::exit(0);
    });

    // Start Dante device integration (real with --features inferno, stub otherwise)
    let dante = patchbox_dante::device::DanteDevice::new(
        config.dante_name.clone(),
        config.rx_channels,
        config.tx_channels,
    );
    dante
        .start_with_state(
            state.config.clone(),
            state.meters.clone(),
            state.audio_callbacks.clone(),
            state.resyncs.clone(),
        )
        .await
        .expect("Dante device init failed");
    state
        .dante_connected
        .store(true, std::sync::atomic::Ordering::Relaxed);

    // Simulated meter task — only active when inferno feature is disabled
    #[cfg(not(feature = "inferno"))]
    {
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
                        if routed {
                            ((t + i as f32 * 1.1).sin().abs() * 0.5).max(0.0)
                        } else {
                            0.0
                        }
                    })
                    .collect();
            }
        });
    }

    let app = router(state);
    tracing::info!("listening on http://{}", bind_addr);

    let listener = tokio::net::TcpListener::bind(bind_addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
