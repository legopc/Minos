# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Dante network                               │
│   [Dante TX sources] ──► Dante RX flows ──► [patchbox] ──► Dante TX │
└────────────────────────────────┬────────────────────┬───────────────┘
                                 │ inferno_aoip        │
                           RX callback              TX ring
                                 │                    │
┌────────────────────────────────▼────────────────────▼───────────────┐
│                    patchbox-dante  (bridge layer)                    │
│                                                                      │
│  Sample (i32) ──► f32 normalise ──► AudioBridge::process()          │
│                                           │                          │
│                        ┌──────────────────┘                         │
│                        ▼                                             │
│              patchbox-core  (DSP engine, no I/O)                    │
│                                                                      │
│   inputs[N]            matrix[N×M]            outputs[M]            │
│  ┌────────┐   gain      ┌───────────┐  gain   ┌────────┐            │
│  │ Strip  │──────────►  │ NxM cross │────────►│  Bus   │            │
│  │ (trim) │   routing   │  point    │ master  │ master │            │
│  │ mute   │             │  gains    │         │ mute   │            │
│  │ solo   │             └───────────┘         └────────┘            │
│  └────────┘                                                          │
│                                                                      │
│  AudioParams / MeterFrame ◄── Arc<RwLock> ──► control thread        │
└──────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    patchbox  (binary)                                │
│                                                                      │
│  tokio runtime                                                       │
│  ├── axum HTTP server (port 8080)                                    │
│  │   ├── GET  /api/v1/health                                         │
│  │   ├── GET  /api/v1/state           — full JSON snapshot           │
│  │   ├── PATCH /api/v1/matrix/:in/:out — set gain                   │
│  │   ├── POST /api/v1/channels/*      — strip/bus controls          │
│  │   ├── GET/POST /api/v1/scenes      — scene management            │
│  │   ├── GET /ws                      — WebSocket                   │
│  │   └── /*                           — embedded web-ui             │
│  └── web-ui (rust-embed, baked into binary)                          │
│      index.html + app.js + style.css                                 │
└──────────────────────────────────────────────────────────────────────┘
```

## Architecture Decisions (A1–A6 locked)

### A1 — Sample format: `i32` (24-bit PCM) ✅ Resolved
`inferno_aoip::Sample = i32`. PCM lives in the lower 24 bits of a signed 32-bit int.
- Normalise to f32: `f32 = i32 as f32 / (1 << 23) as f32`
- Denormalise: `i32 = (f32.clamp(-1.0, 1.0) * (1 << 23) as f32) as i32`
- Implemented in `patchbox-dante/src/sample_conv.rs`

### A2 — RT threading model: inline in RX callback ✅ Resolved
DSP runs inline inside the `inferno_aoip` RX callback (`Fn`, not `FnMut`).
- `AudioBridge::process()` is stack-only, no heap allocation on the hot path.
- Shared state accessed via `Arc<RwLock<AudioParams>>::try_read()` — drops frame if locked (glitch-free skip).
- Meter peaks written via `Arc<RwLock<MeterFrame>>::try_write()` — best-effort, skipped if locked.

### A3 — Shared state: `Arc<RwLock<AudioParams>>` ✅ Resolved
`triple_buffer` was considered for lock-free RT ↔ control bridging but rejected for now:
- The tokio `RwLock::try_read()` / `try_write()` are non-blocking; contention in this use-case is negligible (control writes are rare, ~10/sec max; RT reads happen per-block at ~750 Hz for 64-sample blocks at 48 kHz).
- If profiling ever shows contention, `triple_buffer` can be added as a drop-in upgrade — `AudioParams` is already `Clone`.
- **Decision: single `Arc<RwLock<AudioParams>>` shared between REST API and Dante RX callback.** Same Arc for `MeterFrame`.

### A4 — Channel count target: 16×16 configurable ✅ Resolved
- Default config: `n_inputs = 8, n_outputs = 8` (covers 7-bar pub system with headroom).
- `MatrixParams` supports up to `MAX_CHANNELS = 64` without reallocation.
- Configurable via `/etc/patchbox/config.toml` — no recompile needed for common sizes.

### A5 — Dante multicast flow strategy ✅ Resolved
- Use unicast flows by default (Dante Controller manages subscription).
- `inferno_aoip` handles discovery and flow setup transparently.
- No manual multicast configuration in patchbox — Dante Controller (DC) is the subscription manager.
- Channel names (visible in DC) are set via `Settings::make_rx_channels()` / `make_tx_channels()`.

### A6 — Web UI framework: plain HTML/JS/CSS ✅ Resolved
- Zero npm, zero build step — matches the `inferno-iradio` ecosystem standard.
- Embedded via `rust-embed` — single binary deployment, no separate web server.
- IBM Plex Mono + Barlow Condensed from Google Fonts.
- SPA fallback to `index.html` for future zone routing (`/zone/bar-1`).

## Crates

### `patchbox-core`
Pure DSP engine — no I/O, no async. RT-safe.

| Module | Purpose |
|--------|---------|
| `matrix` | NxM f32 gain matrix. `mix()` is the RT hot path — stack-allocated, no heap. |
| `strip`  | Per-input strip params: gain trim, mute, solo. |
| `bus`    | Per-output bus params: master gain, mute. |
| `control`| `AudioParams` + `MeterFrame` — shared via `Arc<RwLock>` between control and RT threads. |
| `scene`  | TOML scene load/save/list. |

### `patchbox-dante`
Dante I/O layer using `inferno_aoip`.

| Module | Purpose |
|--------|---------|
| `device`      | `DanteDevice` — wraps `DeviceServer`, configures RX/TX channels, wires DSP bridge. |
| `bridge`      | `AudioBridge::process()` — RX callback hot path: strip → matrix → bus → peak meters. |
| `sample_conv` | `i32_to_f32` / `f32_to_i32` conversion helpers with round-trip tests. |

Feature flag `inferno` enables real `inferno_aoip` integration. Without the flag, stubs are used so CI works without a Dante network.

### `patchbox`
The main binary (also a library target for integration testing).

| Module | Purpose |
|--------|---------|
| `main`        | Entry point: clap args, config load, tokio runtime, axum serve. |
| `config`      | TOML config struct with defaults. |
| `state`       | `AppState`: shared `Arc<RwLock<AudioParams>>` + `Arc<RwLock<MeterFrame>>`. |
| `api/mod`     | `build_router()` — assembles all routes + `rust-embed` fallback. |
| `api/routes`  | REST handlers — health, state, matrix, channels, scenes. |
| `api/ws`      | WebSocket: state snapshot on connect + ~20 Hz binary Float32Array meter push. |
| `api/assets`  | Embedded asset handler (SPA fallback to `index.html`). |

## Threading model

```
[tokio runtime]
  └── axum HTTP tasks (one per connection)
        └── REST handlers: write to AppState.params (Arc<RwLock>)
  └── WS meter push tasks (one per WS client, 20 Hz timer)
        └── read AppState.meters (Arc<RwLock>)

[inferno_aoip RX callback — real-time, dedicated thread]
  └── AudioBridge::process()
        ├── try_read(AppState.params)    — reads live matrix gains
        ├── apply_strip() → matrix::mix() → apply_bus()
        ├── try_write(AppState.meters)   — writes peak dBFS values
        └── (TODO Phase 2) write TX ring buffers
```

Both `AppState.params` and `AppState.meters` are the **same `Arc` instances** shared between the tokio tasks and the Dante RT callback. No copies, no double buffering needed at this scale.

## Data flows

### Audio (RT path, ~every N samples)
```
inferno_aoip RX callback
  → i32 samples per channel
  → normalize to f32 [-1, 1]          sample_conv::i32_to_f32()
  → apply_strip() per input            gain trim + mute + solo
  → matrix::mix() — NxM cross-point   stack only, no alloc
  → apply_bus() per output             master gain + mute
  → write peak dBFS → MeterFrame       try_write(), skip if locked
  → (Phase 2) denormalize to i32 → TX ring buffers
```

### Metering (~20 Hz to web clients)
```
RT callback → try_write(AppState.meters) peak dBFS values

WS handler (tokio task, 50ms timer)
  → read(AppState.meters)
  → pack as binary Float32Array [inputs..., outputs...]
  → send to WebSocket client
```

### REST control
```
HTTP PATCH /api/v1/matrix/3/5 { "gain": 0.75 }
  → route handler: write_lock(AppState.params)
  → MatrixParams::set(3, 5, 0.75)
  → unlock — RT callback picks up on next block
```

## Authentication

### Login flow

1. Browser loads `index.html` — login overlay is shown immediately (CSS `display: flex`)
2. `initAuth()` IIFE runs: calls `validateStoredToken()` → `GET /api/v1/auth/whoami` with stored JWT
3. If valid token: `hideLoginOverlay()` → `boot()` (full UI load)
4. If invalid/no token: overlay stays visible, user fills in login form
5. Form submit → `POST /api/v1/auth/login` with `{username, password}` (JSON body, never query params)
6. On success: `storeAuth(token, role, zone)` → `hideLoginOverlay()` → `boot()`

### patchFetch monkey-patch

`patchFetch` replaces `window.fetch` at startup. All fetch calls are automatically intercepted:
- Adds `Authorization: Bearer <token>` header for all `/api/` requests
- Skips the header injection for `/auth/login` (to avoid sending stale tokens)
- On 401 response: clears stored token and shows login overlay

This means all existing code (built before auth was added) automatically uses auth without changes.

### PAM + JWT backend

- PAM authentication via `pam_auth::authenticate()` — raw FFI, no dev headers required
- Falls back through: `/etc/pam.d/patchbox` → `/etc/pam.d/sshd` → `/etc/pam.d/su`
- Role determined by Linux group membership: `patchbox-admin`, `patchbox-operator`, `patchbox-bar-<zone>`
- JWT secret: 32 random bytes from `/dev/urandom` generated at startup, stored in `AppState`
- **Secret is NOT persisted** — every server restart invalidates all tokens
- `whoami` handler validates JWT directly from `Authorization: Bearer` header (not via middleware)
- `api_keys` empty → middleware grants Admin role, BUT `whoami` still requires a valid JWT

### WebSocket auth

WS upgrade URL: `ws://<host>:9191/ws?token=<jwt>`
Token validated during the HTTP upgrade handshake. Unauthenticated connections are rejected when `api_keys` is non-empty.

---

## inferno_aoip integration notes

- `Sample = i32` — 24-bit PCM packed in the lower 24 bits of a signed 32-bit int
- Normalisation: `f32 = i32 as f32 / (1 << 23) as f32`
- `DeviceServer::start()` **blocks until a PTP clock is available** — never call in tests or CI without `statime` running
- Requires `CAP_NET_RAW` for multicast sockets (see `systemd/dante-patchbox.service`)
- Channel names visible in Dante Controller are set via `Settings::make_rx_channels()` / `make_tx_channels()`
- Feature-gated: `--features inferno` — CI always builds without this flag

## Scene format

```toml
name = "my-scene"

[matrix]
inputs  = 8
outputs = 8
cells   = [1.0, 0.0, 0.0, ...]   # row-major, nInputs * nOutputs entries

[[inputs]]
label     = "Bar 1 Mic"
gain_trim = 1.0
mute      = false
solo      = false

[[outputs]]
label       = "Zone A Main"
master_gain = 1.0
mute        = false
```
