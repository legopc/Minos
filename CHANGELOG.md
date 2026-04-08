# Changelog

All notable changes to dante-patchbox are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- R-04: Dante device task wrapped in exponential-backoff retry loop (2s→60s cap); cancels cleanly on shutdown
- R-11: `try_set_rt_priority_once()` — elevates DSP audio callback thread to SCHED_FIFO priority 90 (Linux, first invocation only; needs `CAP_SYS_NICE` or rtprio limit)
- R-12: No-alloc / no-lock audit comments on DSP hot path; future improvement tracked as D-01
- R-13: `state_version` AtomicU64 counter in `AppState`; `GET /api/v1/state` returns `ETag: W/"N"` header; `PATCH /api/v1/matrix/:in/:out` honours `If-Match` and returns 412 on stale write; all mutation handlers bump version
- S-04: Optional TLS support via `axum-server` + `rustls`; enable with `--features tls`; configure via `--tls-cert`/`--tls-key` CLI args or `PATCHBOX_TLS_CERT`/`PATCHBOX_TLS_KEY` env vars

---

## Post-Sprint Bugfixes

### Auth system refactor
- Complete rewrite of login overlay and token lifecycle in `app.js`
- `patchFetch` monkey-patch injects Bearer token on all `/api/` requests
- `validateStoredToken()` calls `GET /auth/whoami` on page load to verify stored session
- `initAuth` IIFE gates `boot()` behind successful auth — no double-boot possible
- Fixed login credentials appearing in URL (form method was GET — set to POST)

### Keyboard shortcuts modal (b7f74a5)
- Shortcuts modal (`?` key) could not be closed — missing `.hidden` CSS rule for `.overlay-modal`
- Fixed `.overlay-modal.hidden { display: none }` rule and modal z-index stacking

### Compressor/EQ NaN channel error (83357db)
- `comp-modal-apply` and `eq-modal-apply` handlers called `parseInt(modal.dataset.channel)` without guard
- When modal opened via `openGateModal()` (sets `dataset.mode` but not `dataset.channel`), resulted in NaN
- Backend returned 400 "cannot parse nan as u64"
- Fixed with `isNaN(ch)` guard: shows toast and closes modal instead of firing bad HTTP request
- Matrix layout broken by Sprint 29 adding `display: table` / `display: table-row` CSS overrides
- Removed both duplicate table-layout blocks; restored correct `display: flex` for `.matrix-row`

### Deploy script (a1f4a20)
- Created `deploy.sh` — build + hot-restart that works correctly with watchdog
- Fixes race condition where watchdog could start old binary before new one was in place

---


## [0.1.0] — Sprint 1–7 Baseline

### Added

#### Sprint 1 — Security & Stability Baseline
- BUG-01: Scene file name sanitisation — path traversal prevented
- BUG-02: WebSocket message size limit (1 MiB max)
- S-02: CORS restricted to configured origins (same-origin default)
- R-01: systemd `sd_notify` watchdog heartbeat (optional `systemd` feature)
- R-03: PID lock file — prevents duplicate instances and scene file corruption

#### Sprint 2 — Input Hardening + Atomics
- BUG-03: Matrix cell gain clamped to `[0.0, 4.0]` at API layer (+12 dB max)
- BUG-04: Channel name max length 64 chars; invalid characters scrubbed
- S-07: Internal error details stripped from 500 responses
- R-06: Atomic scene writes (write to `.toml.tmp` + `rename`)
- O-07: `inferno_aoip` git dependency pinned to a specific commit hash

#### Sprint 3 — WebSocket Hardening + Build
- S-06: WebSocket upgrade origin validation
- S-08: WebSocket connection cap (20 global) — returns 429 when exceeded
- R-07: WebSocket backpressure — 50 ms send timeout, slow clients dropped
- R-05: Config validation at startup with clear human-readable errors
- U-07: JavaScript WebSocket reconnect with exponential backoff + jitter
- O-03: LTO + binary stripping in release Cargo profile (~3.4 MB binary)

#### Sprint 4 — Observability
- R-08: Structured JSON logging option (`RUST_LOG_FORMAT=json`)
- R-02: Deep health check — uptime, WS connections, scenes dir writability
- R-09: Prometheus metrics exporter on `port+1` (`patchbox_ws_connections`, `patchbox_uptime_seconds`)
- R-10: Graceful Dante unsubscribe on SIGTERM via `tokio::select!` + `Arc<Notify>`
- U-03: Matrix cell gain tooltip showing dB value; `−∞` label for silence

#### Sprint 5 — Web UI Polish
- U-04: Mobile/tablet responsive layout — 48 px touch targets, `@media (max-width:900px)`
- U-08: Canvas VU meters with peak-hold decay (green→orange→red gradient)
- U-02: Keyboard navigation — arrow keys move focus, Enter/Space toggle, m=mute, s=solo
- T-01: WebSocket integration test (real TCP listener, `tokio-tungstenite`)
- T-03: Scene roundtrip test; T-05: `schema_version` field with serde default for backward compat

#### Sprint 6 — Zone / Multi-bar UI
- U-01: Zone API — `GET /api/v1/zones` + `GET /api/v1/zones/:id` with filtered matrix slice
- S-01: API key authentication middleware (`X-Api-Key` / `Authorization: Bearer`)
- D-09: mDNS/DNS-SD registration (`_http._tcp`, `_dante-patchbox._tcp`) via `mdns-sd`
- D-03: Dante device name + channel counts announced as mDNS TXT records

#### Sprint 7 — Auth + RBAC + PTP Health
- S-03: `tower_governor` global rate limiting
- S-05: `Role` enum (Admin/Operator/BarStaff/ReadOnly) per API key; injected as axum extension
- D-02: statime PTP daemon health check — `/run/statime/offset` read + `/proc` fallback

---

## v2 Roadmap — Sprints 8–21

#### Sprint 8 — Operations & Build
- O-01: Multi-stage Docker build — builder + slim runtime stage
- O-02: CI matrix: `stable`, `beta`, `1.75.0` Rust toolchain
- O-04: Static binary option (`RUSTFLAGS='-C target-feature=+crt-static'`)
- O-06: `cargo-audit` in CI; deny.toml advisory database
- O-08: Binary size tracking in CI — comment on PR if release binary grows >5%
- T-02: Property-based tests for `matrix::mix()` via `proptest`

#### Sprint 9 — Reliability
- R-04: Dante device task exponential-backoff retry loop
- R-11: SCHED_FIFO thread priority for RT callback (Linux, `CAP_SYS_NICE`)
- R-12: No-alloc hot-path audit with comments
- R-13: ETag / If-Match optimistic concurrency on matrix writes

#### Sprint 10 — Observability + UX
- O-05: `patchbox --version` prints git SHA + build date (`vergen`)
- U-05: Drag-to-resize splitter between panels
- U-06: Scene diff view — compare two scenes before loading
- T-04: Resize observer for responsive panel reflow

#### Sprint 11 — DSP Modals
- D-05: 4-band parametric EQ per input (backend + frontend modal with curve canvas)
- D-06: Compressor/limiter per output (backend + frontend modal with GR graph)
- U-09: EQ and compressor enabled/disabled toggle in strip

#### Sprint 12 — Dante Audio Path
- D-01: Real `inferno_aoip` audio path enabled via `--features inferno`
- D-04: TX ring buffer — denormalized i32 samples written back to Dante TX
- D-10: Dante RX/TX channel name sync from config

---

## v3 Roadmap — Sprints 13–30

#### Sprint 13 — Security + Bug Fixes
- CSP header hardening (no unsafe-inline)
- XSS input sanitisation on channel names
- WS message bounds validation
- Canvas gradient cache refactor
- Numerous frontend bug fixes from IMPROVEMENT_ROADMAP_v2 review

#### Sprint 14 — Touch/Mobile
- Haptic feedback on toggle interactions
- Fader lock mode (prevent accidental fader moves)
- Kiosk mode (full-screen, no browser chrome)
- Coarse pointer media queries for large touch targets

#### Sprint 15 — Zone Management + Matrix Views
- STRIPS/MATRIX toggle view
- Zone editor (assign outputs to zones in UI)
- Active connection filter for matrix

#### Sprint 16 — Amber Redesign
- Noise grain texture on background
- Stacking toast notifications
- Color tags on strips
- Light theme + dark theme toggle
- Channel strip sort controls

#### Sprint 17 — Advanced Strip Controls
- Phase invert (φ) per input strip
- Stereo link (⊸) pairs adjacent strips
- Fan-out (⇶) one source to multiple destinations
- Shift-drag bulk select for matrix cells

#### Sprint 18 — Metering
- Clip latch indicator (holds until acknowledged)
- RMS bar alongside peak bar
- Gradient cache for meter backgrounds
- Peak decay config (fast/slow/infinite)
- Master L/R meter in header

#### Sprint 19 — Zone Overview + Scheduler
- Zone overview panel (▦) — all zones at a glance
- Zone groups (link zones for simultaneous control)
- Time-based scheduler (⏰) — load scenes/presets at scheduled times

#### Sprint 20 — Performance
- State fingerprint (skip needless UI rebuilds)
- GPU-accelerated fader drag (CSS `will-change: transform`)
- PWA — manifest.json + service worker for offline shell

#### Sprint 21 — Accessibility
- Full ARIA labels and roles
- Focus trap in modals (ESC always closes)
- High-contrast theme
- `prefers-color-scheme` auto-detect
- Onboarding overlay for first-time users

#### Sprint 22 — Mixer Core Layout (v3)
- M-01: Vertical channel strips with tall CSS/SVG faders
- M-07: Input gain staging (trim vs fader gain structure)
- M-12: Strip-embedded VU meters (not just global meters panel)
- M-06: AFL/PFL solo mode toggle (global setting)

#### Sprint 23 — Patchbay Intelligence
- P-01: Dante subscription status overlay (subscribed/error/pending per cell)
- P-03: Connection search/filter (filter rows + columns by name)
- P-04: Broken/lost connection indicator (RX loss → red flashing cell)
- P-08: Cell hover tooltip (signal level + Dante latency)

#### Sprint 24 — Pan + DSP Visuals
- M-02: Pan/balance knob per input (new `POST /channels/input/:id/pan`)
- M-10: HPF quick toggle per strip (new `POST /channels/input/:id/hpf`)
- M-08: EQ curve canvas in EQ modal (frequency response graph)
- M-09: Compressor GR history graph + threshold/ratio line

#### Sprint 25 — Zone Multi-bar
- Z-01: URL zone routing — `#/zone/<id>` scopes UI to zone outputs
- Z-02: Per-zone master volume fader
- Z-03: Zone source selector (carousel/picker)
- Z-04: Zone presets (save/load named zone states)

#### Sprint 26 — PAM Auth + JWT
- A-01: PAM authentication (raw FFI, no dev headers required)
- A-02: Zone-scoped bar-staff view (auto-redirect to zone after login)
- A-05: WebSocket token auth (token in WS upgrade URL)

#### Sprint 27 — Patchbay Advanced
- P-02: Device tree browser (channels grouped by Dante device)
- P-05: Batch connect (select sources → assign to multiple outputs)
- P-06: Routing templates (named connection presets, separate from scenes)
- P-09: Spider/cable view mode (visual connection lines)

#### Sprint 28 — Mixer Advanced
- M-03: Aux sends (4 per input strip)
- M-04: VCA/DCA group faders
- M-11: Noise gate per channel (threshold gate with UI toggle)
- M-13: Insert bypass toggle (bypass all DSP in one click)

#### Sprint 29 — Performance
- T-01: Virtual scroll for large matrices (>32 channels, DOM window)
- T-02: Binary WebSocket meter protocol (packed Float32Array, ~20 Hz)
- T-03: Debounced fader with server-side smoothing
- T-04: Resize observer for responsive layout reflow

#### Sprint 30 — Polish
- U-01: Undo history panel (visual stack of last N operations)
- U-02: Keyboard shortcut reference modal (`?` key)
- U-03: WebSocket status/connection banner
- U-04: Toast notification centre
- U-07: Strip compact/expand mode

---

[Unreleased]: https://github.com/legopc/dante-patchbox/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/legopc/dante-patchbox/releases/tag/v0.1.0
