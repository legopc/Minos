# dante-patchbox

A Rust-native Dante AoIP matrix mixer and DSP patchbay for pub/venue sound systems — browser UI + REST API + WebSocket metering.

[![CI](https://github.com/legopc/dante-patchbox/actions/workflows/ci.yml/badge.svg)](https://github.com/legopc/dante-patchbox/actions/workflows/ci.yml)

---

## What it does

Designed for a pub with ~7 bars, a central Linux server, and per-bar tablet control points:

- Accepts **N Dante RX streams** (via `inferno_aoip`) into a single virtual device
- Processes audio through an **NxM DSP matrix** — gain per cross-point, per-strip mute/solo/gain trim, per-bus master gain
- Transmits **M processed Dante TX streams** back onto the network
- Exposes a **browser UI** served from the same port as the REST API — no separate server, no install
- Supports **zones** — each bar tablet can see only its assigned outputs
- Registers via **mDNS** (`_http._tcp`, `_dante-patchbox._tcp`) for zero-config discovery

```
http://device-ip:9191          ← web patchbay
http://device-ip:9191/api/v1/health
http://device-ip:9192/metrics  ← Prometheus metrics
ws://device-ip:9191/ws         ← live metering
```

---

## Prerequisites

- Linux (x86_64 or aarch64)
- Rust 1.80+ (MSRV)
- For real Dante audio: `inferno_aoip` with `CAP_NET_RAW` capability and `statime` PTP daemon

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

## Quick start

```bash
# Build
cargo build --release -p patchbox

# Run with defaults (8×8 matrix, port 9191)
PATCHBOX_PORT=9191 ./target/release/patchbox

# Run with a config file
./target/release/patchbox --config /etc/patchbox/config.toml

# Run with TUI dashboard
./target/release/patchbox --tui
```

Open `http://localhost:9191` in your browser.

---

## Configuration

`/etc/patchbox/config.toml` (defaults shown):

```toml
port        = 9191
n_inputs    = 8
n_outputs   = 8
device_name = "dante-patchbox"
scenes_dir  = "~/.local/share/patchbox/scenes"

# CORS — add dev origins here; empty = same-origin only (production default)
allowed_origins = []

# API key authentication — empty = disabled (dev default)
# Format: token = { label = "Bar 1 tablet", role = "bar_staff" }
# Roles: admin | operator | bar_staff | read_only
[api_keys]
# "secret-token-abc" = { label = "Bar 1", role = "bar_staff" }

# Zone definitions — map zone-id → output channel indices
[zones]
# "bar-1" = [0, 1]
# "bar-2" = [2, 3]
```

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Service health, uptime, PTP status |
| GET | `/api/v1/state` | Full matrix + channel state (JSON) |
| PATCH | `/api/v1/matrix/:in/:out` | Set cross-point gain `{ "gain": 0.0–4.0 }` |
| POST | `/api/v1/channels/input/:id/mute` | Toggle input mute |
| POST | `/api/v1/channels/input/:id/solo` | Toggle input solo |
| POST | `/api/v1/channels/input/:id/name` | Rename input `{ "name": "..." }` |
| POST | `/api/v1/channels/input/:id/gain_trim` | Set strip gain `{ "gain": 0.0–4.0 }` |
| POST | `/api/v1/channels/output/:id/mute` | Toggle output mute |
| POST | `/api/v1/channels/output/:id/name` | Rename output |
| POST | `/api/v1/channels/output/:id/master_gain` | Set bus master gain |
| GET | `/api/v1/scenes` | List saved scenes |
| POST | `/api/v1/scenes` | Save scene `{ "name": "..." }` |
| GET | `/api/v1/scenes/:name` | Load (apply) a saved scene |
| DELETE | `/api/v1/scenes/:name` | Delete a saved scene |
| GET | `/api/v1/zones` | List configured zones |
| GET | `/api/v1/zones/:zone_id` | Zone-scoped state (filtered matrix + outputs) |

### Authentication

When `api_keys` is non-empty, include one of:
```
X-Api-Key: <token>
Authorization: Bearer <token>
```

### WebSocket `/ws`

- On connect: server sends `{ "op": "snapshot", "state": { ... } }` (full state)
- ~20 Hz: server sends binary `Float32Array` — `[n_inputs f32 dBFS, n_outputs f32 dBFS]`

---

## Keyboard shortcuts (web UI)

| Key | Action |
|-----|--------|
| `←↑→↓` | Move focus |
| `Enter` / `Space` | Toggle crosspoint |
| `m` | Mute focused input |
| `s` | Solo focused input |

---

## Troubleshooting

**Port already in use**  
Check for an existing process: `cat /tmp/patchbox.pid` and `kill <pid>`.

**Dante Controller doesn't see the device**  
Real Dante integration requires `--features inferno` build, `statime` PTP daemon running,  
and the binary granted `CAP_NET_RAW`:
```bash
sudo setcap 'cap_net_raw=eip' ./target/release/patchbox
```

**mDNS not working**  
mDNS requires multicast on the local network. Check firewall rules allow UDP port 5353.

**Prometheus metrics not visible**  
Metrics are served on `port+1` (default 9192): `curl http://localhost:9192/metrics`

---

## Crate structure

```
crates/
  patchbox-core/    — NxM DSP matrix, per-strip/bus params, scene I/O (no I/O, no async)
  patchbox-dante/   — inferno_aoip integration + RT audio bridge
  patchbox/         — axum HTTP server, WebSocket, rust-embed web UI, CLI
web-ui/             — plain HTML/JS/CSS patchbay UI (baked into the binary)
docs/PROJECT.md     — project context, pub scenario, process rules
IMPROVEMENT_ROADMAP.md  — engineering backlog
CHANGELOG.md        — version history
```

---

## Status

- [x] NxM gain matrix engine with DSP unit tests
- [x] Per-channel strip (gain trim, mute, solo)
- [x] Per-bus output (master gain, mute)
- [x] Scene save/load (TOML, atomic writes)
- [x] REST API (full CRUD for matrix, channels, scenes, zones)
- [x] WebSocket metering push (~20 Hz)
- [x] Browser UI — dark theme, canvas VU meters, keyboard nav, mobile responsive
- [x] Zone API — per-bar filtered matrix view
- [x] API key auth + RBAC (Admin/Operator/BarStaff/ReadOnly)
- [x] Rate limiting (global, 200 burst)
- [x] mDNS auto-discovery
- [x] Prometheus metrics on port+1
- [x] TUI dashboard (ratatui)
- [x] aarch64 cross-compile CI
- [ ] Real Dante audio path (requires `--features inferno` + hardware)
- [ ] TLS (planned Sprint 9)
- [ ] EQ / compressor DSP (planned Sprint 9+)

---

## References

- [teodly/inferno](https://github.com/teodly/inferno) — `inferno_aoip` Dante library
- [legopc/inferno-iradio](https://github.com/legopc/inferno-iradio) — sibling project / UI template

---

## License

MIT
