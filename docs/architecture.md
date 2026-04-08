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
│  AudioParams ◄──── triple_buffer ────► control thread               │
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

## Crates

### `patchbox-core`
Pure DSP engine — no I/O, no async. RT-safe.

| Module | Purpose |
|--------|---------|
| `matrix` | NxM f32 gain matrix. `mix()` is the RT hot path — stack-allocated, no heap. |
| `strip`  | Per-input strip params: gain trim, mute, solo. |
| `bus`    | Per-output bus params: master gain, mute. |
| `control`| `AudioParams` aggregate struct — shared via `triple_buffer` between control and RT threads. |
| `scene`  | TOML scene load/save/list. |

### `patchbox-dante`
Dante I/O layer using `inferno_aoip`.

| Module | Purpose |
|--------|---------|
| `device` | `DanteDevice` — wraps `DeviceServer`, configures RX/TX channels. |
| `bridge` | `AudioBridge::process()` — RX callback hot path: strip → matrix → bus → TX. Sample format: `i32` (24-bit PCM) ↔ `f32` normalisation. |

Feature flag `inferno` enables real `inferno_aoip` integration. Without the flag, stubs are used so CI works without a Dante network.

### `patchbox`
The main binary.

| Module | Purpose |
|--------|---------|
| `main`        | Entry point: clap args, config load, tokio runtime, axum serve. |
| `config`      | TOML config struct. |
| `state`       | `AppState`: `RwLock<AudioParams>` + meter broadcast. |
| `api/mod`     | `build_router()` — assembles all routes + `rust-embed` fallback. |
| `api/routes`  | REST handlers. |
| `api/ws`      | WebSocket handler — state snapshot on connect, ~20 Hz binary meter push. |
| `api/assets`  | Embedded asset handler (SPA fallback to `index.html`). |

## Threading model

```
[tokio runtime]
  └── axum HTTP tasks (one per connection)
  └── WS meter push tasks

[inferno_aoip internals — tokio current_thread or dedicated threads]
  └── RX callback thread (real-time priority)
        └── AudioBridge::process()
              ├── reads AudioParams snapshot (triple_buffer, lock-free)
              ├── applies strip gains
              ├── applies matrix mixing
              └── applies bus gains → writes to TX ring buffers
```

## Parameter bridge (control ↔ RT)

`triple_buffer` provides a wait-free single-producer / single-consumer snapshot:

- **Control thread** (axum handler): `writer.write(new_params); writer.publish()`
- **RT thread** (RX callback): `if reader.update() { use reader.output_buffer() }`

This means API writes are never blocked by the RT thread and vice versa. The RT thread always sees the _most recent complete snapshot_, never a partially-written one.

## Data flows

### Audio (RT path, ~every N samples)
```
inferno_aoip RX callback
  → i32 samples per channel
  → normalize to f32 [-1, 1]
  → apply_strip() per input
  → matrix::mix() — NxM cross-point gain multiplication
  → apply_bus() per output
  → denormalize to i32
  → write to inferno_aoip TX ring buffers
```

### Metering (background, ~20 Hz)
```
RT thread → compute peak dBFS per channel
          → store in AppState::meters (RwLock<MeterFrame>)

WebSocket handler (tokio task, timer)
  → read meters
  → pack as binary Float32Array
  → send to all connected WS clients
```

### REST control
```
HTTP PATCH /api/v1/matrix/3/5 { "gain": 0.75 }
  → route handler reads AppState::params (write lock)
  → updates MatrixParams::cells[3*M+5]
  → on next RT cycle, triple_buffer publishes new snapshot
```

## inferno_aoip integration notes

- `Sample = i32` — 24-bit PCM packed in the lower 24 bits of a 32-bit signed int
- Normalisation: `f32 = i32 as f32 / (1 << 23) as f32`
- Denormalisation: `i32 = (f32 * (1 << 23) as f32) as i32`
- `DeviceServer::start()` **blocks until a PTP clock is available** — never call this in tests or CI without a running clock daemon
- Requires `CAP_NET_RAW` for multicast sockets
- Channel names visible in Dante Controller are set via `Settings::make_rx_channels()` / `make_tx_channels()`

## Scene format

```toml
name = "my-scene"

[matrix]
inputs  = 8
outputs = 8
cells   = [1.0, 0.0, 0.0, ...]   # row-major, nInputs * nOutputs entries

[[inputs]]
label     = "Mic 1"
gain_trim = 1.0
mute      = false
solo      = false

[[outputs]]
label       = "Main L"
master_gain = 1.0
mute        = false
```
