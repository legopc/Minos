# dante-patchbox — *Minos*

A Dante AoIP software patchbay and DSP mixer for venue audio systems. Runs as a single binary — no separate web server, no database, no runtime dependencies.

This patchbay is named **Minos** after the judge in Dante Alighieri's *Divine Comedy* — the figure who stands at the entrance to the Inferno and routes each soul to where they belong. Just as Minos directs souls to their proper circle, this software routes audio sources to their proper destinations. All credit for the Dante protocol implementation goes to the creators of the [Inferno AoIP project](https://gitlab.com/lumifaza/inferno) — this patchbay builds on their work.

> **⚠️ AI-ASSISTED CODE — READ BEFORE RUNNING**
>
> This repository is substantially AI-assisted. The Rust source code, web UI, and configuration were written with the help of an AI coding assistant. **Do not blindly run code in a production environment without understanding what it does.** Review the source before deploying.
>
> That said: this is being actively developed and tested against real Dante hardware. Phase 0 (routing matrix, DSP, web UI, authentication), Phase 0.5 (real Dante audio integration), and Phase 1 (per-output parametric EQ + brick-wall limiter, latency tuning) are all complete and running on production hardware. "AI-assisted" doesn't mean untested — it means you should still read what you're running.

---

## What it does

Minos accepts Dante audio streams as RX inputs, routes them through a configurable NxM DSP matrix, and transmits processed audio back onto the Dante network as TX outputs. A browser-based web interface provides:

- **Routing matrix** — route any source to any output zone
- **Per-input gain staging** — level each source independently
- **Per-output volume control** — master level and mute per zone
- **DSP** — per-output EQ and limiting (in development)
- **Scenes** — save and load complete routing + gain presets
- **Zone views** — per-zone touchpanel UI for bar staff
- **Live metering** — WebSocket VU meters at 20fps
- **Authentication** — PAM + JWT, role-based (admin / operator / zone staff)

```
Dante network
    │
    ├─ RX: sources in (appliances, AVIO adapters, DVS PCs, any Dante TX)
    │       ↓
    │   [Minos — dante-patchbox]
    │   NxM routing matrix + DSP
    │       ↓
    └─ TX: zone outputs (subscribed to by amp AVIO adapters / Shure MXWANI8)
```

Minos is part of the **Inferno AoIP Ecosystem** — a family of open-source Dante-compatible audio tools:

| Component | Name | Role |
|-----------|------|------|
| Appliance OS | **Virgil** | Headless Fedora IoT node — Spotify, AUX, iRadio → Dante |
| Patchbay | **Minos** | Dante routing matrix, DSP, zone control |
| Fleet management | inferno-central | Node discovery, health monitoring, OTA |

---

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Routing matrix, gains, scenes, auth, web UI, metering | ✅ Complete |
| Phase 0.5 | Real Dante audio via Inferno AoIP, hardware testing | ✅ Complete |
| Phase 1 | Per-output DSP (3-band parametric EQ + brick-wall limiter), latency tuning, idempotent deploy script | ✅ Complete |
| Phase 2 | Zone ownership, subscription management | ⏳ Planned |

See [`docs/PROJECT.md`](docs/PROJECT.md) for the full architecture and roadmap, and [`docs/AUDIO_ENGINE.md`](docs/AUDIO_ENGINE.md) for the hardware-tested audio-path notes.

---

## Quick start

```bash
# Build (stub audio — no Dante hardware required)
cargo build --release

# Run
./target/release/patchbox --config config.toml.example
```

Open `http://localhost:9191` — log in with a Linux system user account.

To build with real Dante audio support (requires a PTP daemon plus `cap_net_raw` and `cap_sys_nice` on the deployed binary):

```bash
cargo build --release --features inferno
sudo setcap cap_net_raw,cap_sys_nice+ep ./target/release/patchbox
```

`cap_net_raw` is required for Dante raw sockets; `cap_sys_nice` is required so the DSP callback can elevate to `SCHED_FIFO`.

---

## Configuration

See [`config.toml.example`](config.toml.example) for a minimal configuration. Key fields:

```toml
rx_channels = 4          # Number of Dante RX inputs
tx_channels = 3          # Number of Dante TX outputs
zones = ["Bar 1", "Bar 2", "Stage"]
sources = ["Main Bar", "DVS PC", "Podium", "Spare"]
dante_name = "minos"     # Dante device name as seen on network
dante_nic = "eth0"       # Network interface for Dante
dante_clock_path = "/tmp/ptp-usrvclock"  # Statime PTP clock socket
port = 9191
```

---

## Architecture

Minos is a single Rust binary built on:
- **[axum](https://github.com/tokio-rs/axum)** — HTTP and WebSocket server
- **[inferno_aoip](https://gitlab.com/lumifaza/inferno)** — Dante protocol implementation (feature-gated)
- **[rust-embed](https://github.com/pyros2097/rust-embed)** — web UI embedded in the binary
- **PAM + JWT** — authentication via Linux system accounts

The audio DSP path runs in the Inferno RX callback with no allocations and no locks — RT-safe by design. Config changes propagate via a lock-free triple buffer so the web API never blocks the audio thread.

## Audio engine

The live Dante path was tuned and debugged on real hardware. The important fixes were: correct Dante 24-bit sample scaling, gap-free TX ring advancement, event-driven inferno wakeups, `SCHED_FIFO` callback scheduling, and a silence guard for inferno's external TX ring. See [`docs/AUDIO_ENGINE.md`](docs/AUDIO_ENGINE.md) for the full chronology, root-cause notes, and current latency model.

---

## Credits

Minos builds on the work of:
- [**lumifaza / inferno-aoip**](https://gitlab.com/lumifaza/inferno) — the open-source Dante protocol implementation that makes this possible. All credit for the protocol reverse-engineering goes to its original authors.
- [**teodly / statime**](https://github.com/teodly/statime) — the PTP implementation used for clock synchronisation.
- [**legopc / inferno-aoip-releases (Virgil)**](https://github.com/legopc/inferno-aoip-releases) — the appliance that provides Dante audio sources this patchbay routes.

---

## License

AGPLv3 — see [LICENSE](LICENSE).
