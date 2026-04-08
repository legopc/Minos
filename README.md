# dante-patchbox

A Rust-native Dante AoIP matrix mixer and DSP patchbay — with a first-class browser UI.

[![CI](https://github.com/legopc/dante-patchbox/actions/workflows/ci.yml/badge.svg)](https://github.com/legopc/dante-patchbox/actions/workflows/ci.yml)

---

## What it does

- Accepts **N Dante RX streams** (via `inferno_aoip`) into a single Inferno virtual device
- Processes audio through an **NxM DSP matrix** (gain per cross-point, per-strip mute/solo, per-bus master gain)
- Transmits **M processed Dante TX streams** back onto the network
- Exposes a **browser UI** served from the same port as the API — no separate server, no install

```
http://device-ip:8080   ← web patchbay
http://device-ip:8080/api/v1/health
ws://device-ip:8080/ws  ← live metering
```

---

## Quick start

```bash
# Build
cargo build --release -p patchbox

# Run with defaults (8×8 matrix, port 8080)
./target/release/patchbox

# Run with config
./target/release/patchbox --config /etc/patchbox/config.toml
```

Open `http://localhost:8080` in your browser.

---

## Configuration

`config.toml` (defaults shown):

```toml
port        = 8080
n_inputs    = 8
n_outputs   = 8
device_name = "dante-patchbox"
scenes_dir  = "~/.local/share/patchbox/scenes"
```

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Service health + config info |
| GET | `/api/v1/state` | Full matrix + channel state (JSON) |
| PATCH | `/api/v1/matrix/:in/:out` | Set cross-point gain `{ "gain": 0.0–1.0 }` |
| POST | `/api/v1/channels/input/:id/mute` | Toggle input mute |
| POST | `/api/v1/channels/input/:id/solo` | Toggle input solo |
| POST | `/api/v1/channels/input/:id/name` | Rename input `{ "name": "..." }` |
| POST | `/api/v1/channels/output/:id/mute` | Toggle output mute |
| POST | `/api/v1/channels/output/:id/name` | Rename output |
| GET | `/api/v1/scenes` | List saved scenes |
| POST | `/api/v1/scenes` | Save scene `{ "name": "..." }` |
| GET | `/api/v1/scenes/:name` | Load (apply) a saved scene |

### WebSocket `/ws`

- On connect: server sends `{ "op": "snapshot", "state": { ... } }` (full state)
- ~20 Hz: server sends binary `Float32Array` — `[n_inputs f32 dBFS, n_outputs f32 dBFS]`

---

## Crate structure

```
crates/
  patchbox-core/    — NxM DSP matrix, per-strip/bus params, scene I/O (no I/O, no async)
  patchbox-dante/   — inferno_aoip integration + RT audio bridge
  patchbox/         — axum HTTP server, WebSocket, rust-embed web UI, CLI
web-ui/             — plain HTML/JS/CSS patchbay UI (baked into the binary)
```

---

## Status

> ⚠️ Early development — `patchbox-dante` audio path is a stub until `inferno_aoip` callback API is confirmed (see [A1 in IMPROVEMENT_ROADMAP.md](IMPROVEMENT_ROADMAP.md)).

- [x] NxM gain matrix engine
- [x] Per-channel strip (gain, mute, solo)
- [x] Per-bus output (master gain, mute)
- [x] Scene save/load (TOML)
- [x] REST API skeleton
- [x] WebSocket metering push
- [x] Browser UI (plain HTML/JS, dark theme)
- [ ] Real Dante audio path (blocked on A1)
- [ ] TUI (ratatui)
- [ ] Docker + aarch64 cross-compile

---

## References

- [teodly/inferno](https://github.com/teodly/inferno) — `inferno_aoip` Dante library
- [legopc/inferno-iradio](https://github.com/legopc/inferno-iradio) — sibling project / UI template
- [dasp](https://github.com/RustAudio/dasp) — DSP sample processing
- [fundsp](https://github.com/SamiPerttu/fundsp) — DSP graph nodes

---

## License

MIT
