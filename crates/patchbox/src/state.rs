use patchbox_core::control::{AudioParams, MeterFrame};
use patchbox_core::scene;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;
use tokio::sync::{Notify, RwLock};

use crate::config::Config;

pub struct AppState {
    pub config: Config,
    /// Audio parameters — shared between the REST API and the Dante audio bridge.
    pub params: Arc<RwLock<AudioParams>>,
    /// Live peak-metering data — written by the RT callback, read by the WS task.
    pub meters: Arc<RwLock<MeterFrame>>,
    /// Active WebSocket connection count — used for connection limit enforcement.
    pub ws_connections: Arc<AtomicUsize>,
    /// Process start time — used for uptime reporting in /health.
    pub started_at: Instant,
    /// Notified on graceful shutdown — Dante task listens to cancel cleanly (R-10).
    pub shutdown: Arc<Notify>,
    /// R-13: Monotonic version counter — incremented on every state mutation.
    /// Used to generate ETags for optimistic concurrency control.
    pub state_version: Arc<AtomicU64>,
    /// U-09: Display order for input channels (permutation of 0..N-1).
    pub input_order: Arc<RwLock<Vec<usize>>>,
    /// U-09: Display order for output channels (permutation of 0..N-1).
    pub output_order: Arc<RwLock<Vec<usize>>>,
}

impl AppState {
    pub fn new(cfg: Config) -> Self {
        let n_in  = cfg.n_inputs;
        let n_out = cfg.n_outputs;
        Self {
            params:         Arc::new(RwLock::new(AudioParams::new(n_in, n_out))),
            meters:         Arc::new(RwLock::new(MeterFrame::new(n_in, n_out))),
            ws_connections: Arc::new(AtomicUsize::new(0)),
            started_at:     Instant::now(),
            shutdown:       Arc::new(Notify::new()),
            state_version:  Arc::new(AtomicU64::new(1)),
            input_order:    Arc::new(RwLock::new((0..n_in).collect())),
            output_order:   Arc::new(RwLock::new((0..n_out).collect())),
            config:         cfg,
        }
    }

    /// R-13: Increment the state version and return the new value.
    /// Call this after every mutation that changes routing state.
    pub fn bump_version(&self) -> u64 {
        self.state_version.fetch_add(1, Ordering::Release) + 1
    }

    /// R-13: Current ETag string (weak ETag format).
    pub fn etag(&self) -> String {
        format!("W/\"{}\"", self.state_version.load(Ordering::Acquire))
    }

    pub fn scenes_dir(&self) -> PathBuf {
        PathBuf::from(&self.config.scenes_dir)
    }

    /// Persist the current params as a named scene.
    pub async fn save_scene(&self, name: &str) -> Result<(), scene::SceneError> {
        let params = self.params.read().await.clone();
        let s = scene::Scene { schema_version: 1, name: name.to_owned(), params };
        scene::save(&self.scenes_dir(), &s)
    }

    /// Load and apply a named scene.
    pub async fn load_scene(&self, name: &str) -> Result<(), scene::SceneError> {
        let s = scene::load(&self.scenes_dir(), name)?;
        let mut params = self.params.write().await;
        *params = s.params;
        Ok(())
    }
}

pub type SharedState = Arc<AppState>;
