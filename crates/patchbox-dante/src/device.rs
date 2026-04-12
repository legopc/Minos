//! `DanteDevice` — wraps `inferno_aoip::DeviceServer`.
//!
//! With `--features inferno`: creates a real Dante device visible in Dante
//! Controller, starts RX/TX flows, wires the DSP matrix in the RX callback.
//!
//! Without the feature: runs a no-op stub so that the rest of the binary
//! compiles and runs in CI / dev without hardware.

use anyhow::Result;
use patchbox_core::config::PatchboxConfig;
use patchbox_core::meters::MeterState;
use std::sync::Arc;
use tokio::sync::RwLock;

/// A Dante virtual device (or stub).
pub struct DanteDevice {
    pub device_name: String,
    pub n_rx: usize,
    pub n_tx: usize,
    /// Keeps the DeviceServer alive — dropping it destroys the mDNS broadcaster.
    #[cfg(feature = "inferno")]
    server: std::sync::Mutex<Option<inferno_aoip::device_server::DeviceServer>>,
}

impl DanteDevice {
    pub fn new(device_name: impl Into<String>, n_rx: usize, n_tx: usize) -> Self {
        Self {
            device_name: device_name.into(),
            n_rx,
            n_tx,
            #[cfg(feature = "inferno")]
            server: std::sync::Mutex::new(None),
        }
    }

    /// Start with shared state.
    ///
    /// With `feature = "inferno"`: spins up `DeviceServer`, registers RX/TX
    /// channels, attaches the DSP matrix as the RX callback, and starts TX.
    ///
    /// Without the feature: logs a warning and returns — the sim meter task
    /// in main.rs continues to provide fake meter data.
    pub async fn start_with_state(
        &self,
        config: Arc<RwLock<PatchboxConfig>>,
        meters: Arc<RwLock<MeterState>>,
    ) -> Result<()> {
        #[cfg(feature = "inferno")]
        {
            self.start_real(config, meters).await
        }
        #[cfg(not(feature = "inferno"))]
        {
            let _ = config;
            let _ = meters;
            tracing::warn!(
                name = %self.device_name,
                rx = self.n_rx,
                tx = self.n_tx,
                "Dante stub active — compile with --features patchbox-dante/inferno for real audio"
            );
            Ok(())
        }
    }

    #[cfg(feature = "inferno")]
    async fn start_real(
        &self,
        config: Arc<RwLock<PatchboxConfig>>,
        meters: Arc<RwLock<MeterState>>,
    ) -> Result<()> {
        use inferno_aoip::device_server::{
            AtomicSample, DeviceServer, ExternalBufferParameters, Settings,
        };
        use inferno_aoip::device_server::Clock;
        use std::sync::atomic::Ordering as AOrdering;
        use std::sync::atomic::AtomicUsize;
        use std::time::Duration;
        use triple_buffer::triple_buffer;

        let short = if self.device_name.len() > 14 {
            &self.device_name[..14]
        } else {
            &self.device_name
        };

        let mut settings = Settings::new(
            &self.device_name,
            short,
            None,  // clock path set below after initial_cfg
            &Default::default(),
        );
        settings.make_rx_channels(self.n_rx);
        settings.make_tx_channels(self.n_tx);
        settings.self_info.product_version_bytes = Some([4, 1, 6, 2]);

        tracing::info!(
            name = %self.device_name,
            rx = self.n_rx,
            tx = self.n_tx,
            "Starting inferno_aoip DeviceServer (waiting for PTP clock…)"
        );

        // Wire PTP clock path — must be set before DeviceServer::start consumes settings
        {
            let cfg_snapshot = config.read().await;
            if !cfg_snapshot.dante_clock_path.is_empty() {
                settings.clock_path = Some(std::path::PathBuf::from(&cfg_snapshot.dante_clock_path));
                tracing::info!(clock = %cfg_snapshot.dante_clock_path, "using PTP clock");
            }
        }
        // LAN-optimised latency settings (see LATENCY TUNING comment near LEAD_SAMPLES).
        // 1 ms: minimum for LAN Dante. Drives three things:
        //   - flow negotiation minimum (max of our 1ms + sender's min, usually 1ms → 1ms total)
        //   - mDNS-advertised TX latency (what downstream receivers buffer)
        //   - mDNS-advertised RX latency capability (what DC picks for flows into us)
        settings.tx_latency_ns = 1_000_000;
        settings.self_info.tx_latency_ns = 1_000_000;
        settings.self_info.latency_ns = 1_000_000;
        settings.rx_jitter_samples = 192;   // 4 ms hole-fix wait — fine for a clean LAN
        let mut server = DeviceServer::start(settings).await;
        tracing::info!("inferno_aoip DeviceServer started");

        // TX ring buffer setup — non-interleaved, power-of-2 size.
        // RING_SIZE >> LEAD_SAMPLES: prevents TX from reading overwritten data even at
        // maximum realistic drift.  32768 @ 48 kHz = 682 ms ring; LEAD_SAMPLES = 4 ms.
        const RING_SIZE: usize = 32768;
        let n_tx = self.n_tx;
        let n_rx = self.n_rx;

        let valid = Arc::new(std::sync::RwLock::new(true));

        let tx_bufs: Vec<Arc<Vec<AtomicSample>>> = (0..n_tx)
            .map(|_| Arc::new((0..RING_SIZE).map(|_| AtomicSample::new(0)).collect()))
            .collect();

        let current_timestamp = Arc::new(AtomicUsize::new(0));
        let write_pos_atomic = Arc::new(AtomicUsize::new(0));  // callback's exclusive write pointer

        let tx_params: Vec<ExternalBufferParameters<i32>> = tx_bufs
            .iter()
            .map(|buf| unsafe {
                ExternalBufferParameters::new(
                    buf.as_ptr(),
                    RING_SIZE,
                    1,
                    Arc::clone(&valid),
                    None,
                )
            })
            .collect();

        let (start_tx, start_rx) = tokio::sync::oneshot::channel::<Clock>();

        server
            .transmit_from_external_buffer(
                tx_params,
                start_rx,
                Arc::clone(&current_timestamp),
                None,
            )
            .await;

        tracing::info!("TX transmitter armed — polling for PTP clock");

        // Poll for PTP clock and record the wall-clock instant of capture.
        // We use Instant to estimate elapsed samples at first-callback time,
        // aligning write_pos without needing TX flows to be active yet.
        let (ptp_at_poll, instant_at_poll): (Clock, std::time::Instant) = {
            use inferno_aoip::device_server::{MediaClock, RealTimeClockReceiver};
            let mut clock_rx: RealTimeClockReceiver = server.get_realtime_clock_receiver();
            let mut ptp: Clock = 0;
            for attempt in 0..200 {
                clock_rx.update();
                if let Some(overlay) = clock_rx.get() {
                    let mut mc = MediaClock::new(false);
                    mc.update_overlay(*overlay);
                    if let Some(ts) = mc.wrapping_now_in_timebase(48000) {
                        tracing::info!(ptp_at_poll = ts, attempt, "PTP clock polled");
                        ptp = ts;
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            if ptp == 0 {
                tracing::warn!("PTP clock not available after 2s — ring alignment may be off");
            }
            (ptp, std::time::Instant::now())
        };

        // Triple buffer for RT-safe config delivery to audio callback
        // The audio callback NEVER touches the RwLock — zero contention.
        let initial_cfg = config.read().await.clone();
        let (mut tb_input, mut tb_output) = triple_buffer(&initial_cfg);

        // Background task: push config updates into triple buffer every 10ms
        let config_ref = config.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(10));
            loop {
                interval.tick().await;
                if let Ok(cfg) = config_ref.try_read() {
                    tb_input.write(cfg.clone());
                }
            }
        });

        let tx_bufs_cb = tx_bufs.clone();
        let write_pos_cb = Arc::clone(&write_pos_atomic);
        // Diagnostic only: TX transmitter writes min_next_ts here after each batch.
        // Used in the 5-second alignment log to verify lead is stable; not used for write_pos.
        let current_ts_cb = Arc::clone(&current_timestamp);
        let mut start_tx_opt: Option<tokio::sync::oneshot::Sender<Clock>> = Some(start_tx);
        // ── LATENCY TUNING ──────────────────────────────────────────────
        // Three knobs control audio playthrough latency:
        //
        //   1. Event-driven wakeup (samples_collector.rs via TransferNotifier + Notify)
        //      Replaces 2 ms polling. Wakeup now fires within <0.5 ms of packet arrival.
        //      Minimum batching delay ≈ 0 ms (event-driven).
        //
        //   2. LEAD_SAMPLES (below) — TX ring write-ahead.
        //      Audio written here won't be transmitted until LEAD_SAMPLES / 48000 s later.
        //      With SCHED_FIFO + event-driven wakeup, jitter is <0.5 ms → LEAD can be 2 ms.
        //      Safety ladder: 96 (2 ms, 1.5 ms margin) → 192 (4 ms) → 384 (8 ms, very safe).
        //
        //   3. settings.tx_latency_ns — Dante TX flow latency and flow negotiation minimum.
        //      Also controls self_info.latency_ns (mDNS-advertised RX capability) and
        //      self_info.tx_latency_ns (advertised TX latency to downstream receivers).
        //      At 1 ms: max(MXWANI8_min=1ms, our_min=1ms) = 1 ms jitter-buffer hold-back.
        //
        // Total audio latency ≈ flow_latency + wakeup_latency + LEAD/48000 + tx_latency_ns.
        // At current settings: 1 ms + <0.5 ms + 2 ms + 1 ms ≈ 4-5 ms (our portion).
        //
        // NOTE: the monitoring device's own RX jitter buffer and DAC buffer also add latency.
        // If pops return after reducing LEAD_SAMPLES, increase it.
        // Step up: 96 → 128 → 192. Never below ~48 (1 ms) with SCHED_FIFO.
        // ────────────────────────────────────────────────────────────────
        // LEAD_SAMPLES: how far ahead write_pos stays of the TX read position.
        // With event-driven wakeup (<0.5 ms jitter) + SCHED_FIFO, 96 (2 ms) is safe.
        // If pops return: step up to 128 (2.7 ms) or 192 (4 ms, very safe).
        const LEAD_SAMPLES: usize = 96;

        server.receive_with_callback(Box::new(move |samples_count, channels| {
            use crate::sample_conv::{i32_to_f32, f32_to_i32};

            // Elevate DSP thread to SCHED_FIFO once per thread
            #[cfg(target_os = "linux")]
            try_set_rt_priority_once();

            // Lock-free config read from triple buffer — always has a valid snapshot
            let cfg = tb_output.read();

            let actual_rx = channels.len().min(n_rx);
            let block     = samples_count;

            // Convert RX i32 → f32
            let rx_f32: Vec<Vec<f32>> = (0..actual_rx)
                .map(|i| channels[i][..block].iter().map(|&s| i32_to_f32(s)).collect())
                .collect();

            let mut tx_f32: Vec<Vec<f32>> = (0..n_tx)
                .map(|_| vec![0.0f32; block])
                .collect();

            let inputs_ref:       Vec<&[f32]>      = rx_f32.iter().map(|v| v.as_slice()).collect();
            let mut outputs_ref:  Vec<&mut [f32]> = tx_f32.iter_mut().map(|v| v.as_mut_slice()).collect();

            // Run DSP matrix
            patchbox_core::matrix::process(&inputs_ref, &mut outputs_ref, cfg);

            // Update meters with linear RMS (best-effort, non-blocking)
            if let Ok(mut m) = meters.try_write() {
                for (i, ch) in rx_f32.iter().enumerate() {
                    if i < m.rx_rms.len() {
                        m.rx_rms[i] = rms_linear(ch);
                    }
                }
                for (i, ch) in tx_f32.iter().enumerate() {
                    if i < m.tx_rms.len() {
                        m.tx_rms[i] = rms_linear(ch);
                    }
                }
            }

            // Write processed samples into TX ring buffers.
            //
            // Linear write position: advance by `block` (= PTP-derived sample count from
            // inferno's jitter buffer) each callback.  Since `block` tracks the PTP clock
            // at exactly the same rate as the TX transmitter, write_pos stays exactly
            // LEAD_SAMPLES ahead of TX with no drift and no gaps between consecutive writes.
            //
            // Self-correcting from tx_ptp was removed: Tokio's 50 ms interval fires with
            // ±jitter, so recomputing write_pos = tx_ptp + LEAD each callback creates
            // micro-gaps between writes whenever the interval fires late — those gaps hit
            // TX as silent zeros → pops.  Pure linear advance eliminates the gaps.
            //
            // On first block: init write_pos = elapsed + LEAD and send start_time = ptp_at_poll.
            if let Some(tx) = start_tx_opt.take() {
                let elapsed_ns = instant_at_poll.elapsed().as_nanos() as usize;
                let elapsed_samples = elapsed_ns * 48_000 / 1_000_000_000;
                write_pos_cb.store(elapsed_samples.wrapping_add(LEAD_SAMPLES), AOrdering::Release);
                if let Err(e) = tx.send(ptp_at_poll) {
                    tracing::warn!("Failed to send TX start time: {e}");
                } else {
                    tracing::info!(
                        ptp_at_poll,
                        write_pos = elapsed_samples + LEAD_SAMPLES,
                        "TX ring armed — write leads TX by {LEAD_SAMPLES} samples"
                    );
                }
            }

            let write_pos = write_pos_cb.load(AOrdering::Acquire);

            // ── Silence guard & gap-resumption resync ──────────────────────
            // ExternalBuffer uses unconditional_read=true: TX reads ring
            // positions even before write_pos reaches them.  After the first
            // ring revolution (~682 ms at 48 kHz) those positions hold old
            // audio → pop whenever write_pos stalls during silence.
            //
            //  block==0 (silence): zero-fill ring from write_pos up to
            //    tx_current_pos + LEAD_SAMPLES so TX always reads silence.
            //  block > 2×LEAD (gap resumption): snap write_pos to tx+LEAD
            //    to prevent latency runaway from buffered silence samples.
            // ──────────────────────────────────────────────────────────────
            let tx_guard = current_ts_cb.load(AOrdering::Acquire);
            if block == 0 {
                if tx_guard != 0 && tx_guard != usize::MAX {
                    let tx_off = tx_guard.wrapping_sub(ptp_at_poll as usize);
                    let target = tx_off.wrapping_add(LEAD_SAMPLES);
                    let needed = target.wrapping_sub(write_pos) as isize;
                    if needed > 0 && needed < RING_SIZE as isize {
                        for buf in &tx_bufs_cb {
                            for i in 0..needed as usize {
                                buf[write_pos.wrapping_add(i) % RING_SIZE]
                                    .store(0, AOrdering::Relaxed);
                            }
                        }
                        write_pos_cb.store(target, AOrdering::Release);
                    }
                }
                return;
            }
            let write_pos = if block > LEAD_SAMPLES * 2
                && tx_guard != 0
                && tx_guard != usize::MAX
            {
                let tx_off = tx_guard.wrapping_sub(ptp_at_poll as usize);
                let snapped = tx_off.wrapping_add(LEAD_SAMPLES);
                write_pos_cb.store(snapped, AOrdering::Release);
                snapped
            } else {
                write_pos
            };
            // ──────────────────────────────────────────────────────────────

            for (o, ch) in tx_f32.iter().enumerate() {
                if o >= tx_bufs_cb.len() { break; }
                let buf = &tx_bufs_cb[o];
                for (i, &s) in ch[..block].iter().enumerate() {
                    let idx = (write_pos.wrapping_add(i)) % RING_SIZE;
                    buf[idx].store(f32_to_i32(s), AOrdering::Relaxed);
                }
            }
            write_pos_cb.store(write_pos.wrapping_add(block), AOrdering::Release);

            // Diagnostic: log ring alignment every ~2500 callbacks (≈5 s at 2ms READ_INTERVAL).
            {
                use std::sync::atomic::AtomicUsize;
                static CB_COUNT: AtomicUsize = AtomicUsize::new(0);
                let n = CB_COUNT.fetch_add(1, AOrdering::Relaxed);
                if n % 2500 == 0 {
                    let tx_ptp = current_ts_cb.load(AOrdering::Acquire);
                    if tx_ptp != 0 && tx_ptp != usize::MAX {
                        let lead = write_pos.wrapping_sub(
                            tx_ptp.wrapping_sub(ptp_at_poll as usize)
                        );
                        tracing::debug!(write_pos, tx_ptp, lead, block, "ring alignment");
                    }
                }
            }
        })).await;

        // Keep server alive — dropping it destroys DeviceMDNSResponder → BroadcasterHandle,
        // which kills the mDNS broadcaster and removes the device from Dante Controller.
        *self.server.lock().unwrap() = Some(server);

        Ok(())
    }
}

/// Compute linear RMS of a sample block.
#[inline]
fn rms_linear(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Set SCHED_FIFO on the calling thread (Linux only), once per thread.
#[cfg(all(feature = "inferno", target_os = "linux"))]
fn try_set_rt_priority_once() {
    use std::cell::Cell;
    thread_local! {
        static TRIED: Cell<bool> = const { Cell::new(false) };
    }
    TRIED.with(|tried| {
        if tried.get() { return; }
        tried.set(true);
        let ret = unsafe {
            let param = libc::sched_param { sched_priority: 90 };
            libc::sched_setscheduler(0, libc::SCHED_FIFO, &param)
        };
        if ret == 0 {
            tracing::info!("DSP thread elevated to SCHED_FIFO priority 90");
        } else {
            tracing::debug!(
                "SCHED_FIFO not granted (needs CAP_SYS_NICE or rtprio limit): errno={}",
                unsafe { *libc::__errno_location() }
            );
        }
    });
}
