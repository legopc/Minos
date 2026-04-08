use clap::Parser;
use patchbox::api;
use patchbox::config;
use patchbox::state;
use patchbox::tui;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;

#[derive(Parser, Debug)]
#[command(
    name    = "patchbox",
    about   = "Dante AoIP matrix mixer and DSP patchbay",
    version
)]
struct Args {
    #[arg(short, long, default_value = "/etc/patchbox/config.toml", env = "PATCHBOX_CONFIG")]
    config: String,

    #[arg(short, long, env = "PATCHBOX_PORT")]
    port: Option<u16>,

    /// Launch the terminal UI dashboard (ratatui) alongside the HTTP server.
    #[arg(long)]
    tui: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // When TUI is active, suppress log output — it would corrupt the ratatui screen.
    // Logs are still available via RUST_LOG to a file if needed.
    if !args.tui {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "patchbox=info,tower_http=warn".parse().unwrap()),
            )
            .init();
    }

    let mut cfg = config::Config::load(&args.config).unwrap_or_else(|e| {
        tracing::warn!("Config load failed ({}), using defaults", e);
        config::Config::default()
    });

    if let Some(port) = args.port {
        cfg.port = port;
    }

    tracing::info!(
        "patchbox v{} starting — {}×{} matrix — port {}",
        env!("CARGO_PKG_VERSION"),
        cfg.n_inputs,
        cfg.n_outputs,
        cfg.port
    );

    let app_state = Arc::new(state::AppState::new(cfg.clone()));

    // Share params and meters Arcs with the Dante device so the RX callback
    // reads the live matrix and writes back live peak meters — same objects,
    // no copies.
    {
        let dante = patchbox_dante::device::DanteDevice::new(
            &cfg.device_name,
            cfg.n_inputs,
            cfg.n_outputs,
        );
        let params_arc = Arc::clone(&app_state.params);
        let meters_arc = Arc::clone(&app_state.meters);
        tokio::spawn(async move {
            if let Err(e) = dante.start_with_params(params_arc, meters_arc).await {
                tracing::error!("Dante device error: {}", e);
            }
        });
    }

    let router = api::build_router(app_state.clone(), cfg.clone());
    let addr   = SocketAddr::from(([0, 0, 0, 0], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!("Listening on http://{}", addr);
    tracing::info!("Web UI: http://{}:{}", addr.ip(), cfg.port);

    if args.tui {
        // Spawn TUI in a blocking thread — ratatui uses blocking crossterm I/O.
        // The thread owns a clone of the state Arc.
        let tui_state = Arc::clone(&app_state);
        let port = cfg.port;
        let tui_handle = tokio::task::spawn_blocking(move || {
            tui::run(tui_state, port)
        });

        // Run axum server until TUI exits or signal received
        tokio::select! {
            result = axum::serve(listener, router).with_graceful_shutdown(shutdown_signal()) => {
                result?;
            }
            result = tui_handle => {
                // TUI exited (user pressed q) — shut down the server too
                if let Ok(Err(e)) = result { tracing::error!("TUI error: {}", e); }
            }
        }
    } else {
        axum::serve(listener, router)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c   => { tracing::info!("received Ctrl+C, shutting down"); }
        _ = terminate => { tracing::info!("received SIGTERM, shutting down"); }
    }
}
