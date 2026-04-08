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

    /// Log format: "text" (default) or "json" for structured log ingestion.
    #[arg(long, default_value = "text", env = "RUST_LOG_FORMAT")]
    log_format: String,

    /// S-04: Path to TLS certificate PEM file. When set, HTTPS is enabled.
    #[arg(long, env = "PATCHBOX_TLS_CERT")]
    tls_cert: Option<String>,

    /// S-04: Path to TLS private key PEM file. Required when --tls-cert is set.
    #[arg(long, env = "PATCHBOX_TLS_KEY")]
    tls_key: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // R-08: Structured JSON logging — set RUST_LOG_FORMAT=json for Loki/Grafana ingestion.
    if !args.tui {
        let filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "patchbox=info,tower_http=warn".parse().unwrap());
        if args.log_format == "json" {
            tracing_subscriber::fmt().json().with_env_filter(filter).init();
        } else {
            tracing_subscriber::fmt().with_env_filter(filter).init();
        }
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

    // R-09: Prometheus metrics exporter — starts a background HTTP scrape endpoint.
    let metrics_port = cfg.port + 1; // e.g. 9192 when main is 9191
    if let Err(e) = metrics_exporter_prometheus::PrometheusBuilder::new()
        .with_http_listener(SocketAddr::from(([0, 0, 0, 0], metrics_port)))
        .install()
    {
        tracing::warn!("Prometheus metrics exporter failed to start: {}", e);
    } else {
        tracing::info!("Prometheus metrics on http://0.0.0.0:{}/metrics", metrics_port);
    }

    let app_state = Arc::new(state::AppState::new(cfg.clone()));

    // Share params and meters Arcs with the Dante device so the RX callback
    // reads the live matrix and writes back live peak meters.
    // R-04: Auto-reconnect — the task restarts with exponential backoff on error.
    // R-10: shutdown Notify cancels the retry loop gracefully.
    {
        let params_arc   = Arc::clone(&app_state.params);
        let meters_arc   = Arc::clone(&app_state.meters);
        let shutdown_arc = Arc::clone(&app_state.shutdown);
        let device_name  = cfg.device_name.clone();
        let n_in         = cfg.n_inputs;
        let n_out        = cfg.n_outputs;

        tokio::spawn(async move {
            let mut backoff_secs: u64 = 2;
            loop {
                let dante = patchbox_dante::device::DanteDevice::new(&device_name, n_in, n_out);
                tokio::select! {
                    result = dante.start_with_params(Arc::clone(&params_arc), Arc::clone(&meters_arc)) => {
                        match result {
                            Ok(()) => {
                                // Graceful exit (stub returns Ok immediately).
                                tracing::info!("Dante device task finished normally");
                                return;
                            }
                            Err(e) => {
                                tracing::error!("Dante device error (retrying in {}s): {}", backoff_secs, e);
                                // Clamp backoff at 60s.
                                backoff_secs = (backoff_secs * 2).min(60);
                            }
                        }
                    }
                    _ = shutdown_arc.notified() => {
                        tracing::info!("Dante task received shutdown signal");
                        return;
                    }
                }

                // Wait before reconnecting (but cancel immediately on shutdown).
                let delay = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs));
                tokio::select! {
                    _ = delay => {}
                    _ = shutdown_arc.notified() => { return; }
                }
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

    // S-03: Rate limiting requires ConnectInfo<SocketAddr> — use make_service.
    let service = api::make_service(app_state.clone(), cfg.clone());
    let addr   = SocketAddr::from(([0, 0, 0, 0], cfg.port));

    // S-04: TLS — if --tls-cert and --tls-key are provided, serve HTTPS.
    let tls_enabled = args.tls_cert.is_some() && args.tls_key.is_some();

    if tls_enabled {
        #[cfg(feature = "tls")]
        {
            let cert_path = args.tls_cert.as_deref().unwrap();
            let key_path  = args.tls_key.as_deref().unwrap();

            let cert_pem = std::fs::read(cert_path)
                .map_err(|e| anyhow::anyhow!("Cannot read TLS cert {}: {}", cert_path, e))?;
            let key_pem  = std::fs::read(key_path)
                .map_err(|e| anyhow::anyhow!("Cannot read TLS key {}: {}", key_path, e))?;

            let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem(cert_pem, key_pem).await
                .map_err(|e| anyhow::anyhow!("TLS config error: {}", e))?;

            tracing::info!("Listening on https://{}", addr);
            tracing::info!("Web UI: https://{}:{}", addr.ip(), cfg.port);
            register_mdns(&cfg);

            axum_server::bind_rustls(addr, tls_config)
                .serve(service)
                .await?;
        }
        #[cfg(not(feature = "tls"))]
        {
            tracing::error!("--tls-cert/--tls-key supplied but binary was compiled without 'tls' feature. Rebuild with --features tls.");
            std::process::exit(1);
        }
    } else {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        tracing::info!("Listening on http://{}", addr);
        tracing::info!("Web UI: http://{}:{}", addr.ip(), cfg.port);
        register_mdns(&cfg);

        if args.tui {
            let tui_state = Arc::clone(&app_state);
            let port = cfg.port;
            let tui_handle = tokio::task::spawn_blocking(move || tui::run(tui_state, port));

            tokio::select! {
                result = axum::serve(listener, service).with_graceful_shutdown(shutdown_signal()) => {
                    result?;
                }
                result = tui_handle => {
                    if let Ok(Err(e)) = result { tracing::error!("TUI error: {}", e); }
                }
            }
        } else {
            axum::serve(listener, service)
                .with_graceful_shutdown(shutdown_signal())
                .await?;
        }
    }

    // R-10: Signal Dante task to shut down gracefully before exiting.
    app_state.shutdown.notify_waiters();

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

/// D-09: Register mDNS/DNS-SD services so tablets can auto-discover the server.
///
/// Registers two services:
///   - `_http._tcp` at port `cfg.port` — the web control UI
///   - `_dante-patchbox._tcp` at port `cfg.port` — custom service type for
///     patchbox-aware clients
fn register_mdns(cfg: &config::Config) {
    use mdns_sd::{ServiceDaemon, ServiceInfo};

    let mdns = match ServiceDaemon::new() {
        Ok(d)  => d,
        Err(e) => {
            tracing::warn!("mDNS daemon failed to start ({}); discovery disabled", e);
            return;
        }
    };

    let hostname = hostname_or_fallback();
    let port = cfg.port;
    let device = cfg.device_name.clone();

    // D-03: announce device name + channel count as TXT records
    let mut txt = std::collections::HashMap::new();
    txt.insert("device".to_owned(),  device.clone());
    txt.insert("inputs".to_owned(),  cfg.n_inputs.to_string());
    txt.insert("outputs".to_owned(), cfg.n_outputs.to_string());

    for svc_type in &["_http._tcp.local.", "_dante-patchbox._tcp.local."] {
        let instance = format!("{}.{}", device, svc_type);
        match ServiceInfo::new(svc_type, &device, &hostname, (), port, Some(txt.clone())) {
            Ok(info) => {
                if let Err(e) = mdns.register(info) {
                    tracing::warn!("mDNS register {} failed: {}", instance, e);
                } else {
                    tracing::info!("mDNS: registered {} on port {}", instance, port);
                }
            }
            Err(e) => tracing::warn!("mDNS ServiceInfo build failed: {}", e),
        }
    }

    // Keep the daemon alive — leak it intentionally (lives for process lifetime).
    std::mem::forget(mdns);
}

fn hostname_or_fallback() -> String {
    std::fs::read_to_string("/etc/hostname")
        .unwrap_or_else(|_| "dante-patchbox.local.".to_owned())
        .trim()
        .to_owned()
        + ".local."
}
