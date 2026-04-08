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

    /// Path to PID lock file (prevents duplicate instances).
    #[arg(long, default_value = "/tmp/patchbox.pid", env = "PATCHBOX_PID_FILE")]
    pid_file: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // When TUI is active, suppress log output — it would corrupt the ratatui screen.
    if !args.tui {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "patchbox=info,tower_http=warn".parse().unwrap()),
            )
            .init();
    }

    // R-03: PID lock file — prevents two instances corrupting shared scene files.
    acquire_pid_lock(&args.pid_file)?;

    let mut cfg = config::Config::load(&args.config).unwrap_or_else(|e| {
        tracing::warn!("Config load failed ({}), using defaults", e);
        config::Config::default()
    });

    if let Some(port) = args.port {
        cfg.port = port;
    }

    // R-05: Validate config immediately after loading — fail fast with clear error.
    if let Err(msg) = cfg.validate() {
        eprintln!("patchbox: invalid config: {}", msg);
        std::process::exit(1);
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
    // reads the live matrix and writes back live peak meters.
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

    // R-01: Systemd watchdog — notify ready and send keepalives so systemd can
    // detect and restart a hung process.
    #[cfg(feature = "systemd")]
    {
        sd_notify::notify(true, &[sd_notify::NotifyState::Ready]).ok();
        tokio::spawn(async {
            use std::time::Duration;
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                interval.tick().await;
                sd_notify::notify(false, &[sd_notify::NotifyState::Watchdog]).ok();
            }
        });
    }

    let router = api::build_router(app_state.clone(), cfg.clone());
    let addr   = SocketAddr::from(([0, 0, 0, 0], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!("Listening on http://{}", addr);
    tracing::info!("Web UI: http://{}:{}", addr.ip(), cfg.port);

    if args.tui {
        let tui_state = Arc::clone(&app_state);
        let port = cfg.port;
        let tui_handle = tokio::task::spawn_blocking(move || tui::run(tui_state, port));

        tokio::select! {
            result = axum::serve(listener, router).with_graceful_shutdown(shutdown_signal()) => {
                result?;
            }
            result = tui_handle => {
                if let Ok(Err(e)) = result { tracing::error!("TUI error: {}", e); }
            }
        }
    } else {
        axum::serve(listener, router)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    // Clean up PID file on graceful exit.
    let _ = std::fs::remove_file(&args.pid_file);
    Ok(())
}

/// Write the current PID to `path`. If a file already exists and the PID it
/// contains belongs to a running process, refuse to start (R-03).
fn acquire_pid_lock(path: &str) -> anyhow::Result<()> {
    use std::io::Read;

    if let Ok(mut f) = std::fs::File::open(path) {
        let mut buf = String::new();
        f.read_to_string(&mut buf).ok();
        if let Ok(pid) = buf.trim().parse::<u32>() {
            // On Linux, /proc/<pid> exists iff the process is alive.
            #[cfg(target_os = "linux")]
            if std::path::Path::new(&format!("/proc/{}", pid)).exists() {
                anyhow::bail!(
                    "Another patchbox instance is already running (PID {}). \
                     Delete {} to override.", pid, path
                );
            }
        }
    }

    std::fs::write(path, std::process::id().to_string())?;
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
        _ = ctrl_c    => { tracing::info!("received Ctrl+C, shutting down"); }
        _ = terminate => { tracing::info!("received SIGTERM, shutting down"); }
    }
}
