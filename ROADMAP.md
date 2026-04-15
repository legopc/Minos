# Minos (dante-patchbox) — Roadmap

Dante AoIP software patchbay + DSP mixer. Single binary, HTTP API + WebSocket VU metering on `:9191`, PAM auth → JWT, config at `/etc/patchbox/config.toml`.

---

## Phase History

| Phase | Name | Description | Status |
|---|---|---|---|
| **0** | Core routing | Dante virtual device, NxM routing matrix, per-input gain, per-output volume, browser UI, TOML config persistence | ✅ Complete |
| **0.5** | Hardware hardening | Live Dante audio on Shure MXWANI8, RT-safe callback (SCHED\_FIFO 90), triple-buffer config hot path, event-driven wakeup, atomic config writes, graceful shutdown | ✅ Complete |
| **1** | DSP per output | 3-band parametric EQ + brick-wall limiter per output, latency tuned to ~2–3 ms, GR metering in web UI, idempotent Arch deploy script with statime | ✅ Complete |
| **2** | Zone UI + auth | Zone-scoped `/zone/:id` URL routing, per-zone view (bar staff), role-based JWT (admin/operator/zone-staff), WebSocket live metering | ✅ Complete |
| **3** | Scene management | Scene save/load (full routing + gain snapshot), named scenes, scene REST API | ✅ Complete |

---

## UI Sprint History

| Sprint | Delivered |
|---|---|
| **Sprint 1** | Dark SPA shell, Matrix tab skeleton, Mixer tab skeleton, WebSocket VU backbone |
| **Sprint 2** | Monitor bus backend, RT-safe solo/mute/polarity in DSP callback |
| **Sprint 3** | Matrix crosspoint level glow (orange/amber dots), VU meters with dB scale markings (0/−10/−20/−40 dBFS), solo/mute/polarity buttons on input strips (mixer), DSP badge buttons on matrix rows |
| **Sprint 4** | Input channel rename (double-click ch-name in matrix), output column rename (double-click angled header), resizable input label column (drag right edge, 8 px hit zone), angled output column headers (−60 deg, left-aligned origin), DSP badge sizing (matrix vs mixer distinction) |
| **Sprint 5** | Internal submix buses: named group channels routable as virtual inputs, per-bus DSP chain (gain/polarity/EQ/compressor/gate/HPF), bus strips in Mixer tab, full REST + WS API, matrix bus column headers with coloured dividers |
| **Sprint F** | PFL solo monitoring: headphone output to local ALSA device (`plughw:1,0`), solo/mute bus with additive multi-solo + Ctrl+click exclusive, solo indicator bar, monitor device selector in System tab, hardware volume init on first open |

---

## Upcoming Backlog

### ✅ Critical — All Complete

| Item | Evidence |
|---|---|
| Config fsync on write | `state.rs` — `f.sync_all()` + parent dir fsync after atomic rename |
| Persist error propagation | `api.rs` — `persist_or_500!` macro returns `500 + {"error":…, "in_memory":true}` |
| RT callback panic guard | `device.rs` — `catch_unwind` + circuit breaker (>3 panics/60s → drop SCHED_FIFO) |

---

### ✅ High — All Complete

| Item | Evidence |
|---|---|
| JWT secret persisted to disk | `jwt.rs:65` — loads/creates `/etc/patchbox/jwt.key` |
| JWT refresh flow | `auth_api.rs:66` — `/api/v1/auth/refresh` endpoint registered |
| Input Gain Badge | `api.rs:699` — `input_dsp_to_value()` emits `"am"` block |
| Parameter ramping (zipper noise) | `matrix.rs:17–198` — `RampState` + per-sample `gain_ramp.tick()` |
| Denormal protection | `device.rs:570–578` — MXCSR FTZ+DAZ via inline asm |
| Offline UI banner | `ws.js:47` + `main.js:221–235` + `#offline-banner` in HTML |
| Destructive action modals | `modal.js` — full `confirmModal()` impl; no `window.confirm()` in codebase |
| Config validation on load | `config.rs:535` — `validate()` called before use in `main.rs:34` |
| WS zombie connection cleanup | `api.rs:1936` — `send_task.abort()` on connection drop |
| **Internal submix buses** | ✅ Complete — Sprint 5 |
| **AFL/PFL solo** | ✅ Complete — Sprint F |

---

### 🟡 Medium — UI/UX Improvements

| Item | Status | Description |
|---|---|---|
| Scene modal | ⬜ | Save-as dialog, rename in-place, confirm-on-recall with diff preview |
| EQ curve canvas | ⬜ | Visual frequency response curve rendered on parametric EQ panel |
| GR meters | ⬜ | Gain reduction meters on limiter/compressor/gate DSP panels |
| Clipping detection + indicator | ⬜ | Post-limiter clip counter per output channel; persistent badge showing "CLIPPED ×3"; resets manually |
| Crosspoint pending state | ✅ | `matrix.js` — `_pendingCrosspoints` map + CSS `pending` class guards double-click |
| Persistent peak hold on meters | ✅ | `mixer.js` — `strip-meter-peak-hold` elements per strip with hold line |
| DSP panel overflow fix | ✅ | Panels constrained to viewport — no off-screen rendering |
| Fader edit affordance | ⬜ | Double-click to type exact dB value is undiscoverable; add tooltip or pencil icon on dB label |
| Keyboard shortcuts | ✅↗ | Core shortcuts implemented; can be expanded (e.g. `?` help overlay, additional bindings) |
| API retry on transient failure | ✅ | `api.js:47–55` — `reqWithRetry` with 3× exponential backoff on GET/PUT |
| Empty matrix state | ✅ | Hint shown when no routes exist |
| Config backup/restore UI | ⬜ | Add scheduled backup endpoint + restore from list of last 10 backups in System tab |

---

### 🟢 Audio / DSP Improvements

| Item | Description |
|---|---|
| DC blocker on inputs | 1st-order HPF at ~0.5 Hz removes phantom power DC offset accumulation |
| Scene recall crossfade | Ramp gain/EQ/compression changes over configurable time (0–5000ms) instead of instant snap |
| True peak + LUFS metering | 3× oversampled true peak detector + EBU R128 block-based LUFS for broadcast/streaming |
| Gate look-ahead | 1–5ms look-ahead buffer in GateExpander prevents gate chop on fast transients |
| Compressor look-ahead + sidechain | 0–20ms look-ahead + optional HPF sidechain filter + dry/wet parallel compression blend |
| Per-channel delay compensation | Track DSP latency per chain; auto-align shorter channels to longest for phase coherence |
| Variable sample rate | `SAMPLE_RATE` hardcoded to 48kHz; parameterise for 44.1k/96k support |
| Stereo width / M/S processing | Optional M/S matrix on output pairs with width_pct (0–200%) + correlation metering |
| Dither on output | Triangular dither before bit-depth downsampling (24→16 bit) for quiet-signal quality |
| De-esser | Frequency-selective gate variant: sidechain HPF (4–8kHz) triggers attenuation of full band |

---

### ⚪ Low / Future

| Item | Description |
|---|---|
| Bulk mutations API | `POST /api/v1/bulk-update` — batch route/gain changes in one transaction; reduces 1024 calls to 1 for 32×32 full repatch |
| Prometheus metrics endpoint | `/metrics` — `audio_callbacks_total`, `resyncs_total`, `ws_clients_active`, `config_write_duration_ms` |
| Audit log | Structured JSON log of who changed what route/config and when; write to `/var/log/patchbox-audit.log` |
| Config schema versioning | `schema_version` field + migration functions; reject future-version configs with helpful error |
| Rate limiting | 100 req/s per IP on public endpoints; 429 + Retry-After on breach |
| PTP health accuracy | `ptp_locked` currently just checks socket exists; poll actual clock offset + add `ptp_offset_ns` to health response |
| API response consistency | Standardise all mutations to `204 No Content`; all errors to `{error, code}` JSON |
| Scene scheduler | Time-based auto-recall (e.g. "Stage open at 20:00") |
| Matrix keyboard nav | Arrow keys move crosspoint focus, Enter toggles route |
| Dynamic EQ | Frequency-dependent compression on a PEQ band; 1-band variant for output de-essing |
| Input insert sends | Post-compressor send/return point for aux effects or external hardware inserts |
| Integration tests for persistence | Test atomic write race conditions, corruption recovery, config upgrade paths |

---

## Cross-project Dependencies

| Dependency | Detail | Status |
|---|---|---|
| statime PTP | Unix socket `/tmp/ptp-usrvclock` | ✅ Running on dante-doos (192.168.1.25) |
| inferno-central | Fleet discovery via health endpoint | ⏳ inferno-central not yet built |

---

## Workspace Layout

```
dante-patchbox/
├── crates/
│   ├── patchbox-core/    # routing matrix, DSP (EQ + limiter), config types
│   ├── patchbox-dante/   # Inferno AoIP integration, RT audio callback
│   └── patchbox/         # binary: HTTP API, WebSocket, PAM/JWT auth
├── web/                  # browser UI (embedded in binary via rust-embed)
├── scripts/              # install-arch.sh — idempotent Arch deploy
├── config/               # statime.toml.example
└── config.toml.example
```
