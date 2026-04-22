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
| AEC via `aec3` crate | ✅ | — | Shipped. |
| VCA groups | ✅ | — | Shipped with members window. |
| Scene recall crossfade | ✅ | — | Shipped. |
| Stereo link | ✅ | — | Shipped (L/R labels indicative, independent routing). |

---

### Sprint 4 — Automixer + Feedback Suppression (~13–20 days) ✅

| Item | Status | Est. | Description |
|---|---|---|---|
| Gain-sharing automixer | ✅ | — | Shipped (Dugan). |
| Gating automixer | ✅ | — | Shipped (NOM). |
| Automixer UI | ✅ | — | Shipped. |
| Feedback suppression | ✅ | — | Shipped (AFS). |

---

### Sprint 5 — DSP Extras + Touch (~11–15 days) ✅

| Item | Status | Est. | Description |
|---|---|---|---|
| Dynamic EQ | ✅ | — | Shipped (4-band, obsoletes de-esser). |
| De-esser | 🚫 | — | Obsoleted by Dynamic EQ. |
| Dither on output | ⬜ | 1 day | Triangular dither before 24→16 bit conversion at end of `PerOutputDsp::process_block()`. |
| Multi-touch fader control | ⬜ | 2 days | Replace mouse events with pointer events in `mixer.js`. Track multiple simultaneous touches by `pointerId`. |
| Custom zone panels | ✅ | — | Zone detail drilldown with full output strips shipped. |

---

### Sprint 6 — System Admin + Polish (~14–18 days) — in progress

See upcoming table above; 6 of 10 items still pending (audit-log, bulk-mutations, prometheus, responsive, scheduler, schema-version).

---

### Sprint 7 — Product Completeness (scoped 2026-04-17)

Derived from gap analysis; scaffolded in repo. See `files/S7_ROADMAP.md` in session-state and commit `7c13bea`.

**Accepted features (5):**

| Item | Status | Scaffold | Description |
|---|---|---|---|
| Snapshot A/B compare + morph | ⬜ | `crates/patchbox/src/ab_compare.rs` | Two scene slots, instant toggle, N-ms parameter morph. |
| MIDI / OSC control surface | ⬜ | `crates/patchbox-control-surface/` | Map hardware (BCF2000, X-Touch, TouchOSC) to faders/mutes/scenes. |
| LUFS meters + auto-gain | ⬜ | `crates/patchbox-core/src/dsp/lufs.rs` | EBU R128 short-term + integrated per output. |
| Sidechain + ducker block | ⬜ | `crates/patchbox-core/src/dsp/ducker.rs` | Sidechain key picker on comp + dedicated ducker for pages-over-music. |
| DSP block preset library | ⬜ | `crates/patchbox/src/presets.rs` | Save/share per-block presets, JSON import/export. |

**Low-prio features (deferred S8+):** recording/streaming tap, RTA/spectrum analyzer, scheduler v2 (sunrise/holidays).

**UI / UX Polish:**

| Item | Status | Description |
|---|---|---|
| Consolidate CSS tokens | ⬜ | Dedupe colour/space tokens into `base.css :root`. |
| Unified fader taper | ⬜ | Audit all `sliderToDb` usages — consistent across matrix / mixer / DEQ. |
| Keyboard shortcuts overlay | ⬜ | `?` modal listing all shortcuts. |
| Undo/redo stack | ⬜ | Config-edit inverse-op ring buffer. |
| Touch / tablet layout v2 | ⬜ | Builds on s6-responsive; collapsible DSP rack. |
| 44 px min touch targets | ⬜ | Increase DSP badge + mute/solo size. |
| Stacking toast queue | ⬜ | Replace 11-line single-slot toast with queue + severity. |
| Matrix search / filter | ⬜ | Filter inputs/outputs + zone filter pills. |
| Route-conflict warnings | ⬜ | Unrouted input / zone without source hints. |
| Per-input colour accent | ⬜ | Channel colour-coding independent of zones. |
| Drag-to-reorder buses & gens | ⬜ | DnD ordering. |
| Meter ballistics option | ⬜ | VU / PPM / digital-peak selection. |
| Accessibility pass | ⬜ | ARIA labels, focus rings, SR meter values. |

**Architecture / tech-debt:**

| Item | Status | Description |
|---|---|---|
| Split api.rs | ✅ | `api/routes/{inputs,outputs,buses,zones,scenes,routing,system}.rs` done; `dsp.rs` still a stub — handlers remain in api.rs (762 lines). |
| Shared strip component | ⬜ | V3: use `/modules/components/channel-strip.js`. |
| Rename api.patch → api.put | ⬜ | Helper actually sends PUT. |
| JSDoc API payload types | ⬜ | Typedefs for state + API shapes. |
| DSP block registry | ⬜ | Single source of truth in `web/src/modules/components/`. |
| Codegen JS defaults from Rust | ✅ | `gen-dsp-defaults.rs` emits `web/src/generated/dsp-defaults.json`; CI codegen-check wired. Consumer import in DSP sections still missing. |
| Collapse input_/output_dsp_to_value | ⬜ | 90% identical — trait/macro. |
| Uniform DSP JSON envelope | ⬜ | Replace ad-hoc `params:` wrapper. |
| Fix 7 rustc warnings | ⬜ | No blanket allow. |
| CI clippy + rustfmt + eslint | ⬜ | `.github/workflows/ci.yml` scaffolded. |

**Testing:**

| Item | Status | Description |
|---|---|---|
| DSP unit tests | ⬜ | Known-answer tests: biquads, AFS, compressor, DEQ. |
| API integration tests | ⬜ | `reqwest` harness + ephemeral config. |
| State JSON snapshot | ⬜ | `insta` golden snapshot of GET /state. |
| Playwright UI smoke | ⬜ | Tab switching, DSP panels, routing, scenes. |
| Config loader fuzz | ⬜ | `cargo fuzz` on `config.rs`. |
| Matrix routing proptest | ⬜ | No feedback loops, bus-order invariant. |

**Ops / productisation:**

| Item | Status | Description |
|---|---|---|
| RBAC roles | ⬜ | admin / engineer / operator-ro. |
| Config backup & restore UI | ⬜ | One-click export + scheduled auto-backups. |
| Structured tracing logs | ⬜ | JSON + runtime log-level control. |
| Deep health endpoint | ⬜ | Dante card, ALSA xruns, DSP CPU headroom. |
| DSP CPU meter in UI | ⬜ | Per-block cost surfaced. |
| OpenAPI spec (utoipa) | ⬜ | Swagger UI at `/api/docs`. |
| User docs site (mdbook) | ⬜ | `docs/` scaffolded. |

**Deferred (S8+ ops):** HTTPS + Let's Encrypt, firmware update channel integration.

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
