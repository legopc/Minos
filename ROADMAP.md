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

> Full implementation specs for all items below are in [GAP_ANALYSIS.md](../GAP_ANALYSIS.md).
> Effort estimates are from that document.

---

### Sprint 1 — Core Mixer Capabilities (~12–14 days)

| Item | Status | Est. | Description |
|---|---|---|---|
| Input Gain Badge fix | ✅ | — | `input_dsp_to_value()` emits `"am"` block — done |
| Internal submix buses | ✅ | — | Complete — Sprint 5 |
| Per-crosspoint gain | ⬜ | 3–4 days | Replace boolean matrix with f32 dB gain per crosspoint. Backward compat: `true→0.0`, `false→-∞`. Scroll/shift-click to adjust. Crosspoint `RampState` for zipper-free changes. |
| DC blocker on inputs | ⬜ | 2 hrs | Fixed 0.5 Hz 1st-order HPF on every input, always on, before all other DSP. Removes phantom DC offset. |

---

### Sprint 2 — Signal Generators + Metering (~8–9 days)

| Item | Status | Est. | Description |
|---|---|---|---|
| Signal generators | ⬜ | 4–5 days | Built-in sine/pink noise/white noise generators as virtual input rows. No-alloc RT: xorshift64 PRNG + Voss-McCartney pink. REST API + matrix/mixer UI rows. |
| GR meters | ⬜ | 1.5 days | Gain reduction meters on compressor/limiter/gate DSP panels. Backend already computes `last_gr_db` — add to WS frames + frontend meter bar. |
| Clipping detection + indicator | ⬜ | 1 day | Post-limiter clip counter per output. Red CLIP badge on strip and matrix header. `POST /api/v1/outputs/:ch/reset-clip`. |
| EQ curve canvas | ⬜ | 1.5 days | HTML5 canvas frequency response curve (20 Hz–20 kHz, log scale) computed from biquad transfer functions. Pure frontend, no backend changes. |
| Peak hold refinement | ⬜ | 0.5 days | Backend: include true peak (max abs sample) alongside RMS in WS metering frames. Frontend already has hold-line display. |

---

### Sprint 3 — AEC + VCA Groups + Scene Crossfade (~16–20 days)

| Item | Status | Est. | Description |
|---|---|---|---|
| AEC via `aec3` crate | ⬜ | 4–5 days | Acoustic echo cancellation per input using the `aec3` crate (pure Rust WebRTC AEC3 port). Feature-gated (`--features aec`). 480-sample accumulator to bridge Dante block size to AEC frame size. Reference signal = assigned zone TX output. |
| VCA groups | ⬜ | 4.5 days | Groups of inputs or outputs controlled by a single gain offset fader. Proportional level control — not audio summing. VCA `RampState` for smooth transitions. Fader strips in Mixer tab. |
| Scene recall crossfade | ⬜ | 4–6 days | Configurable ramp time (0–5000 ms) on scene load. Uses existing `RampState`; routes fade in/out via gain rather than instant crosspoint toggle. |
| Stereo link | ⬜ | 3–4 days | Link adjacent channel pairs with ganged gain/mute/solo and pan control. EQ/dynamics linkable or independent. |

---

### Sprint 4 — Automixer + Feedback Suppression (~13–20 days)

| Item | Status | Est. | Description |
|---|---|---|---|
| Gain-sharing automixer | ⬜ | 3–4 days | Dugan-style: total system gain constant; each mic's gain proportional to its level vs. sum of all. New `dsp/automixer.rs`, sits between input DSP and matrix routing. |
| Gating automixer | ⬜ | 4–5 days | NOM-based attenuation variant. Shares infrastructure with gain-sharing. Adds `off_attenuation_db`, `hold_time_ms`, `last_mic_hold`. |
| Automixer UI | ⬜ | 1–2 days | Panel showing NOM count, per-channel gate/gain state, threshold visualization. |
| Feedback suppression | ⬜ | 5–8 days | Automatic notch filters: detect sustained single-frequency peaks via FFT/Goertzel, insert narrow notch (Q≈30–50). Up to 12 notches per channel with configurable auto-release. |

---

### Sprint 5 — DSP Extras + Touch (~11–15 days)

| Item | Status | Est. | Description |
|---|---|---|---|
| Dynamic EQ | ⬜ | 3–5 days | EQ band that only engages above threshold. Combination of compression + equalization per band. |
| De-esser | ⬜ | 2–3 days | Frequency-selective compressor with HPF sidechain (4–8 kHz). Attenuates sibilance on vocal channels. |
| Dither on output | ⬜ | 1 day | Triangular dither before 24→16 bit conversion at end of `PerOutputDsp::process_block()`. |
| Multi-touch fader control | ⬜ | 2 days | Replace mouse events with pointer events in `mixer.js`. Track multiple simultaneous touches by `pointerId`. |
| Custom zone panels | ⬜ | 3–4 days | Configurable per-zone touchpanel layout. Operator defines visible/locked controls for bar staff. |

---

### Sprint 6 — System Admin + Polish (~14–18 days)

| Item | Status | Est. | Description |
|---|---|---|---|
| Scene modal | ⬜ | 2 days | Save-as dialog, rename in-place (`PATCH /api/v1/scenes/:name`), confirm-on-recall with diff preview. |
| Config backup/restore UI | ⬜ | 2 days | Export/import already exist; add `GET /api/v1/system/backups` list + restore endpoint. UI in System tab. |
| Responsive / mobile layout | ⬜ | 3–4 days | Matrix and mixer views usable on tablets. Touch-friendly hit targets. |
| Audit logging | ⬜ | 1–2 days | Structured JSON log `{timestamp, user, action, endpoint, summary}` → `/var/log/patchbox-audit.log` via tracing. |
| Prometheus metrics | ⬜ | 1–1.5 days | `/metrics` — `audio_callbacks_total`, `resyncs_total`, `ws_clients_active`, `config_write_duration_ms`, `ptp_offset_ns`. |
| PTP health accuracy | ⬜ | 0.5 days | Report actual clock offset + lock duration from statime, not just socket existence. |
| Config schema versioning | ⬜ | 1 day | `schema_version` field + migration functions; reject future-version configs with helpful error. |
| Bulk mutations API | ⬜ | 1–2 days | `POST /api/v1/bulk-update` — batch route/gain/DSP in one transaction. Reduces 1024 calls to 1 for full repatch. |
| Scene scheduler | ⬜ | 2–3 days | Time-based auto-recall (e.g. "Stage open at 20:00", "Background at 02:00"). |
| API rate limiting | ⬜ | 0.5 days | 100 req/s per IP on public endpoints; 429 + Retry-After on breach. |

---

### ✅ Completed — All Sprints Prior

| Item | Completed |
|---|---|
| Config fsync + persist error propagation | Pre-sprint |
| RT callback panic guard + circuit breaker | Pre-sprint |
| JWT secret persistence + token refresh | Pre-sprint |
| Parameter ramping (anti-zipper) | Pre-sprint |
| Denormal protection (FTZ/DAZ) | Pre-sprint |
| Offline UI banner | Pre-sprint |
| Destructive action modals | Pre-sprint |
| Config validation on load | Pre-sprint |
| WS zombie connection cleanup | Pre-sprint |
| Crosspoint pending state | Pre-sprint |
| Persistent peak hold (frontend) | Pre-sprint |
| API retry with exponential backoff | Pre-sprint |
| DSP panel overflow fix | Pre-sprint |
| Keyboard shortcuts (core) | Pre-sprint |
| Empty matrix state hint | Pre-sprint |
| Fader edit affordance | Pre-sprint |
| Input Gain Badge | Sprint 1 |
| Internal submix buses | Sprint 5 |
| AFL/PFL solo monitor | Sprint F |

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
