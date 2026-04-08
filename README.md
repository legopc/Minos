# dante-patchbox

A Rust-native Dante AoIP matrix mixer and DSP patchbay for pub/venue sound systems — browser UI + REST API + WebSocket metering.

[![CI](https://github.com/legopc/dante-patchbox/actions/workflows/ci.yml/badge.svg)](https://github.com/legopc/dante-patchbox/actions/workflows/ci.yml)

> **Handover note (April 2026):** Sprints 1–30 complete. Production server at `http://10.10.1.53:9191`. Use `./deploy.sh` to build and deploy. See [`docs/operations.md`](docs/operations.md) for full ops guide and [`docs/api.md`](docs/api.md) for API reference.

---

## What it does

Designed for a pub with ~7 bars, a central Linux server, and per-bar tablet control points:

- Accepts **N Dante RX streams** (via `inferno_aoip`) into a single virtual device
- Processes audio through an **NxM DSP matrix** — gain per cross-point, per-strip mute/solo/gain trim, per-bus master gain
- Transmits **M processed Dante TX streams** back onto the network
- Exposes a **browser UI** served from the same port as the REST API — no separate server, no install
- Supports **zones** — each bar tablet sees only its assigned outputs with zone-scoped controls
- Registers via **mDNS** (`_http._tcp`, `_dante-patchbox._tcp`) for zero-config discovery

```
http://device-ip:9191          ← web patchbay (login required)
http://device-ip:9191/api/v1/health
http://device-ip:9192/metrics  ← Prometheus metrics
ws://device-ip:9191/ws         ← live metering (token required)
```

---

## Prerequisites

- Linux (x86_64 or aarch64)
- Rust 1.80+ (MSRV)
- For real Dante audio: `inferno_aoip` with `CAP_NET_RAW` capability and `statime` PTP daemon
- For login auth: Linux user accounts + PAM (`/etc/pam.d/patchbox` or fallback to `sshd`)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

## Quick start

```bash
# Build
cargo build --release

# Run with defaults (8×8 matrix, port 9191, auth required)
./target/release/patchbox -p 9191

# Run with a config file
./target/release/patchbox --config /etc/patchbox/config.toml
```

Open `http://localhost:9191` — you will see the login screen. Log in with a Linux system user account.

### Deploy (production)

Always use the deploy script to avoid race conditions with the watchdog:

```bash
./deploy.sh
```

This builds the release binary, kills the current server, and waits for the watchdog to restart with the new binary. See [`docs/operations.md`](docs/operations.md) for details.

---

## Authentication

Login uses **PAM** (Linux system accounts) and issues **JWT tokens**. The login screen always appears on first load.

- PAM service: `/etc/pam.d/patchbox` if it exists, else `/etc/pam.d/sshd` as fallback
- JWT tokens are valid for **8 hours**
- JWT secret is **regenerated on every server restart** — all sessions invalidated on restart
- `api_keys` in config controls API-key-based access for external clients; leave empty for PAM-only

**User roles** (based on Linux group membership, see `crates/patchbox/src/api/pam_auth.rs`):

| Group | Role | Access |
|-------|------|--------|
| `patchbox-admin` | Admin | Full access — all zones, config |
| `patchbox-operator` | Operator | All zones, no system config |
| `patchbox-bar-<id>` | BarStaff | Own zone only, auto-redirects to `/zone/<id>` |
| _(none)_ | ReadOnly | View only |

To add a user:
```bash
sudo useradd -M -s /usr/sbin/nologin barstaff1
sudo passwd barstaff1
sudo usermod -aG patchbox-bar-bar1 barstaff1
```

---

## Configuration

`/etc/patchbox/config.toml` (defaults shown):

```toml
port        = 9191
n_inputs    = 8
n_outputs   = 8
device_name = "dante-patchbox"
scenes_dir  = "~/.local/share/patchbox/scenes"

# CORS — add dev origins; empty = same-origin only (production default)
allowed_origins = []

# API key auth for external clients — empty = PAM login only
# Roles: admin | operator | bar_staff | read_only
[api_keys]
# "secret-token-abc" = { label = "Bar 1 tablet", role = "bar_staff" }

# Zone definitions — output channel indices per zone
[zones]
# "bar-1" = [0, 1]
# "bar-2" = [2, 3]
```

Environment variable overrides:
- `PATCHBOX_CONFIG` — path to config file
- `PATCHBOX_PORT` — override port
- `RUST_LOG` — log filter (`patchbox=info,tower_http=warn`)

---

## Web UI features

The web patchbay is served from the same binary (no separate web server). All HTML/CSS/JS is compiled into the binary via `rust-embed`. **Changes to `web-ui/` require a full `cargo build --release`**.

### Matrix view
- NxM crosspoint gain matrix — click to toggle, right-click for precise gain fader
- Column headers: output labels, master gain faders, compressor buttons (`C`)
- Row headers: input labels, mute/solo buttons
- Keyboard navigation: arrow keys, Enter/Space toggle, `m`=mute, `s`=solo
- Shift-drag for bulk-select cell painting
- Column and row highlight on hover

### Strips view (`STRIPS` tab)
- Vertical channel strips (mixer-style layout)
- Per-input: fader, gain trim, pan/balance knob, HPF toggle, mute, solo, AFL/PFL, EQ button (`EQ`), noise gate button
- Per-output: master gain fader, mute, compressor button (`C`)
- Strip meters embedded in each strip
- VCA group faders
- Compact/expand toggle

### DSP modals
- **EQ** (`EQ` button): 4-band parametric EQ — shelf, peak, high-shelf — with visual frequency curve
- **Compressor/Limiter** (`C` button): threshold, ratio, attack, release, makeup gain + GR graph
- **Noise Gate**: threshold, range, attack, release (per input)
- **HPF**: high-pass filter quick toggle per input strip

### Zones & multi-bar
- Zone URL routing: `http://device/#/zone/bar-1` scopes the UI to that zone's channels
- Zone overview panel (`▦`): per-zone level overview
- Zone master fader per zone
- Zone source selector (which source plays in this zone)
- Zone presets — save/load named zone states independently of global scenes

### Patchbay intelligence
- Dante subscription status overlay per crosspoint
- Connection search/filter (type to filter rows/columns by name)
- Broken connection indicator — RX loss → alert
- Source/destination tree browser (channels grouped by Dante device)
- Batch connect operation
- Routing templates (named connection presets separate from scenes)
- Spider/cable view mode

### Scenes
- Save/load named scenes (global matrix + all channel state)
- Scene diff — compare two scenes before loading
- Undo history panel + Ctrl+Z / Ctrl+Y

### UI polish
- Amber industrial dark theme
- PWA installable (manifest + service worker)
- Full ARIA + keyboard navigation + focus trap on modals
- High-contrast theme support
- Responsive / touch-friendly (48 px touch targets, haptic feedback)
- Kiosk/screen-lock mode (lock display for public-facing screens)
- Fader lock mode (prevent accidental fader moves)
- WS status banner (shows connection state)
- Toast notifications + notification center
- Press `?` for keyboard shortcut reference

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `←↑→↓` | Move matrix focus |
| `Enter` / `Space` | Toggle crosspoint |
| `m` | Mute focused input |
| `s` | Solo focused input |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `?` | Open keyboard shortcut reference |
| `Escape` | Close modals |

---

## REST API

Base URL: `http://<device>:9191/api/v1`

All requests to `/api/v1/*` (except `/auth/login` and `/health`) require authentication:
```
Authorization: Bearer <jwt-token>
```
Or for API-key clients:
```
X-Api-Key: <api-key>
```

See [`docs/api.md`](docs/api.md) for the complete API reference.

### Quick endpoint reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health, uptime, PTP status |
| GET | `/state` | Full matrix + channel state |
| PATCH | `/matrix/:in/:out` | Set crosspoint gain `{ "gain": 0.0–4.0 }` |
| POST | `/channels/input/:id/mute` | Toggle input mute |
| POST | `/channels/input/:id/solo` | Toggle input solo |
| POST | `/channels/input/:id/name` | Rename input |
| POST | `/channels/input/:id/gain_trim` | Input gain trim |
| POST | `/channels/input/:id/eq` | Set 4-band parametric EQ |
| POST | `/channels/input/:id/pan` | Set pan/balance |
| POST | `/channels/input/:id/hpf` | Set high-pass filter |
| POST | `/channels/input/reorder` | Reorder input channels |
| POST | `/channels/output/:id/mute` | Toggle output mute |
| POST | `/channels/output/:id/name` | Rename output |
| POST | `/channels/output/:id/master_gain` | Set bus master gain |
| POST | `/channels/output/:id/compressor` | Set compressor/limiter |
| POST | `/channels/output/reorder` | Reorder output channels |
| GET/POST | `/scenes` | List / save scenes |
| GET/POST/DELETE | `/scenes/:name` | Load / delete scene |
| POST | `/scenes/:name/load` | Apply a saved scene |
| GET | `/zones` | List zones |
| GET | `/zones/:zone_id` | Zone-scoped state |
| POST | `/zones/:zone_id/master-gain` | Zone master gain |
| GET/POST | `/zones/:zone_id/presets` | Zone presets |
| POST | `/zones/:zone_id/presets/:name/load` | Apply zone preset |
| GET/POST | `/templates` | Routing templates |
| POST | `/templates/:name/load` | Apply routing template |
| POST | `/auth/login` | Authenticate (PAM) → JWT |
| GET | `/auth/whoami` | Validate token, return claims |

---

## WebSocket `/ws`

Requires `Authorization: Bearer <token>` query parameter: `ws://device:9191/ws?token=<jwt>`

- **On connect**: server sends `{ "op": "snapshot", "state": { ... } }` (full JSON state)
- **~20 Hz**: server pushes binary `Float32Array` — `[n_inputs × dBFS, n_outputs × dBFS]`

---

## Troubleshooting

**Login doesn't work**  
PAM authentication failed. Check `/etc/pam.d/patchbox` (or `/etc/pam.d/sshd` fallback). The user must exist on the Linux system with a valid password.

**"Connected" appears but app doesn't load after login**  
The JWT was invalidated by a server restart. Clear localStorage in the browser (`F12 → Application → Local Storage → Clear`), then refresh.

**Port already in use / server won't start**  
Check `cat /tmp/patchbox.pid` and `ps aux | grep patchbox`. If the PID file is stale (process not running), `rm /tmp/patchbox.pid` then restart. See [`docs/operations.md`](docs/operations.md).

**My web UI changes aren't showing**  
Assets are compiled into the binary via `rust-embed`. You must run `cargo build --release` and restart the server. Use `./deploy.sh` to do this automatically.

**Compressor/EQ "no channel selected" error**  
The modal was opened without a valid channel. Close and reopen from the correct button. This is a defensive guard — if it triggers, check the browser console for the source.

**Dante Controller doesn't see the device**  
Real Dante integration requires `--features inferno` build, `statime` PTP daemon running, and `CAP_NET_RAW`:
```bash
sudo setcap 'cap_net_raw=eip' ./target/release/patchbox
```

**mDNS not working**  
mDNS requires multicast on the local network. Check firewall allows UDP port 5353.

**Prometheus metrics not visible**  
Metrics are on `port+1` (default 9192): `curl http://localhost:9192/metrics`

---

## Crate structure

```
crates/
  patchbox-core/    — NxM DSP matrix, per-strip/bus params, scene I/O (no I/O, no async)
  patchbox-dante/   — inferno_aoip integration + RT audio bridge
  patchbox/         — axum HTTP server, WebSocket, rust-embed web UI, CLI, PAM auth
web-ui/
  index.html        — SPA shell (login overlay, matrix, strips, modals, sidebars)
  app.js            — all frontend logic (~5300 lines, plain JS, no framework)
  style.css         — amber industrial theme (~2450 lines)
docs/
  PROJECT.md        — project context, pub scenario, work process rules, sprint history
  api.md            — complete API reference
  architecture.md   — system architecture and design decisions
  operations.md     — deployment, ops, auth setup, known gotchas
IMPROVEMENT_ROADMAP_v3.md  — current engineering backlog (50 items)
CHANGELOG.md        — version history
deploy.sh           — build + deploy script (always use this instead of manual restart)
watchdog.sh         — auto-restart on crash (runs as a background process)
```

---

## Status

### Implemented
- [x] NxM gain matrix engine with DSP unit tests
- [x] Per-channel strip (gain trim, mute, solo, pan, HPF)
- [x] Per-bus output (master gain, mute, compressor/limiter)
- [x] 4-band parametric EQ with visual frequency curve
- [x] Noise gate per input
- [x] VCA group faders
- [x] Aux sends (4 per strip)
- [x] Scene save/load (TOML, atomic writes)
- [x] REST API (full CRUD for matrix, channels, scenes, zones, templates)
- [x] WebSocket metering push (~20 Hz, binary Float32Array)
- [x] Browser UI — amber dark theme, canvas VU meters, keyboard nav, mobile responsive
- [x] Zone API — per-bar filtered matrix view with zone master gain and presets
- [x] API key auth + RBAC (Admin/Operator/BarStaff/ReadOnly)
- [x] PAM authentication (Linux user accounts, `/etc/pam.d/patchbox`)
- [x] JWT HS256 sessions (8h expiry, WS token auth)
- [x] Rate limiting (global, 200 burst)
- [x] mDNS auto-discovery
- [x] Prometheus metrics on port+1
- [x] TUI dashboard (ratatui)
- [x] PWA (manifest + service worker)
- [x] Full ARIA accessibility
- [x] Virtual scroll for large matrices (>32 channels)
- [x] Undo/redo history
- [x] Routing templates
- [x] Spider/cable view
- [x] Zone scheduler

### Not yet implemented
- [ ] Real Dante audio path (requires `--features inferno` + hardware)
- [ ] TLS (see `--features tls`, needs cert/key)
- [ ] Cockpit integration panel

---

## References

- [teodly/inferno](https://github.com/teodly/inferno) — `inferno_aoip` Dante library
- [legopc/inferno-iradio](https://github.com/legopc/inferno-iradio) — sibling project / UI template
- [legopc/cockpit-inferno](https://github.com/legopc/cockpit-inferno) — Cockpit panel (future integration)

---

## License

MIT
