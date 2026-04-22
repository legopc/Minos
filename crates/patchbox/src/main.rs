use crate::api::router;
use crate::state::AppState;
use clap::Parser;
use patchbox_core::config::PatchboxConfig;
use std::net::SocketAddr;
use std::path::PathBuf;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod ab_compare;
mod api;
mod auth_api;
mod jwt;
mod morph;
mod openapi;
mod pam_auth;
mod presets;
mod ptp;
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
        if c.schema_version > patchbox_core::config::CURRENT_CONFIG_SCHEMA_VERSION {
            eprintln!(
                "Config schema version {} is newer than supported version {}. Please upgrade patchbox.",
                c.schema_version,
                patchbox_core::config::CURRENT_CONFIG_SCHEMA_VERSION
            );
            std::process::exit(1);
        }
        c.migrate_config();
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

    let mut state = AppState::new(config.clone(), args.config.clone());
    state.audit_log_path = Some(std::path::PathBuf::from("/var/log/patchbox-audit.log"));

    // Startup validation: verify config is writable
    state
        .persist()
        .await
        .expect("startup config write check failed — check permissions on config file");
    tracing::info!("config writability check passed");

    // Graceful shutdown: flush config on SIGINT or SIGTERM
    let state_for_shutdown = state.clone();
    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = sigterm.recv() => {},
        }
        tracing::info!("shutting down — persisting config");
        let _ = state_for_shutdown.persist().await;
        std::process::exit(0);
    });

    // SIGUSR1: hot-reload config from disk without restarting audio/Dante device.
    // Channel counts, dante_name, and port are preserved (startup-time-only).
    let state_for_reload = state.clone();
    let config_path_for_reload = args.config.clone();
    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigusr1 = match signal(SignalKind::user_defined1()) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "SIGUSR1 handler not available");
                return;
            }
        };
        loop {
            sigusr1.recv().await;
            tracing::info!("SIGUSR1 — hot-reloading config (audio path unaffected)");
            let text = match std::fs::read_to_string(&config_path_for_reload) {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!(error = %e, "SIGUSR1 reload: cannot read config file");
                    continue;
                }
            };
            let mut new_cfg: PatchboxConfig = match toml::from_str(&text) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!(error = %e, "SIGUSR1 reload: config parse failed");
                    continue;
                }
            };
            new_cfg.migrate_config();
            new_cfg.normalize();
            if let Err(e) = new_cfg.validate() {
                tracing::error!(error = %e, "SIGUSR1 reload: config validation failed — not applied");
                continue;
            }
            // Preserve startup-only fields — changing these requires a full restart
            {
                let old = state_for_reload.config.read().await;
                new_cfg.rx_channels = old.rx_channels;
                new_cfg.tx_channels = old.tx_channels;
                new_cfg.dante_name = old.dante_name.clone();
                new_cfg.port = old.port;
            }
            *state_for_reload.config.write().await = new_cfg;
            tracing::info!("SIGUSR1 reload: config applied (matrix, DSP, buses updated live)");
        }
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

    // Sprint 6 Track A — lightweight in-memory PTP history sampler (1 Hz)
    {
        let state_for_ptp = state.clone();
        tokio::spawn(async move {
            use std::os::unix::fs::FileTypeExt;
            use std::time::{SystemTime, UNIX_EPOCH};

            let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
            let mut last_locked: Option<bool> = None;
            let mut last_state: Option<String> = None;
            loop {
                tick.tick().await;

                let cfg = state_for_ptp.config.read().await;
                let obs_path = cfg.statime_observation_path.clone();
                let clock_path = cfg.dante_clock_path.clone();
                drop(cfg);

                let offset_ns = if let Some(path) = obs_path.as_deref() {
                    crate::ptp::query_ptp_offset(path).await
                } else {
                    None
                };
                let ptp_state = if let Some(path) = obs_path.as_deref() {
                    crate::ptp::query_ptp_state(path).await
                } else {
                    None
                };

                let dante_connected = state_for_ptp
                    .dante_connected
                    .load(std::sync::atomic::Ordering::Relaxed);
                let ptp_synced = std::fs::metadata(&clock_path)
                    .map(|m| m.file_type().is_socket())
                    .unwrap_or(false);
                let locked = ptp_state
                    .as_deref()
                    .map(crate::ptp::is_ptp_locked_state)
                    .unwrap_or(dante_connected && ptp_synced);

                let ts_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);

                state_for_ptp
                    .push_ptp_history(crate::state::PtpHistorySample {
                        ts_ms,
                        locked,
                        offset_ns,
                        state: ptp_state.clone(),
                    })
                    .await;

                if last_locked != Some(locked) {
                    state_for_ptp
                        .push_event_log(crate::state::EventLogEntry {
                            ts_ms,
                            category: "runtime".to_string(),
                            level: if locked {
                                "info".to_string()
                            } else {
                                "warn".to_string()
                            },
                            message: if locked {
                                "PTP lock acquired".to_string()
                            } else {
                                "PTP lock lost".to_string()
                            },
                            action: None,
                            details: ptp_state.clone(),
                            actor: None,
                            resource: None,
                            context: None,
                        })
                        .await;
                    last_locked = Some(locked);
                }

                if ptp_state != last_state {
                    let next_state = ptp_state.clone();
                    state_for_ptp
                        .push_event_log(crate::state::EventLogEntry {
                            ts_ms,
                            category: "runtime".to_string(),
                            level: "info".to_string(),
                            message: "PTP state changed".to_string(),
                            action: None,
                            details: next_state.clone(),
                            actor: None,
                            resource: None,
                            context: None,
                        })
                        .await;
                    last_state = next_state;
                }
            }
        });
    }

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
