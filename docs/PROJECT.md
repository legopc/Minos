# dante-patchbox — Project Context v2

<!-- This file is the permanent source of truth for project intent.
     Read this before making any architectural decisions.
     Update it when scope or design decisions change. -->

## What This Is

**dante-patchbox** is a Dante AoIP software patchbay and DSP mixer for venue audio systems.

It is the digital equivalent of an analog patchbay: sources arrive from the Dante network as RX
channels, are routed and processed through a configurable matrix, and transmitted back onto the
Dante network as TX channels. Amplifiers, mixers, and other Dante-capable hardware subscribe to
those TX outputs.

## The Venue Context

Het Vliegende Paard — a student café in Zwolle, Netherlands. Multiple areas (7), each with its
own speaker system. The pub runs a Dante network with AVIO adapters on both sources and amps.
The patchbox replaces whatever central routing hardware currently exists with software that is
fully reconfigurable from a browser.

## Architecture

The patchbox is **purely a routing and DSP brain**. It has no audio I/O of its own.

```
Dante network
    │
    ├─ RX: sources in (appliances, AVIO adapters, DVS PCs, anything on Dante)
    │       ↓
    │   [dante-patchbox]
    │   - configurable NxM routing matrix
    │   - per-input gain control
    │   - per-output volume + DSP (EQ, limiter)
    │       ↓
    └─ TX: zone outputs (subscribed to by amp AVIO adapters / Shure MXWANI8 units)
```

Audio I/O (AUX in/out, Spotify, Bluetooth, iradio) lives in the **appliances**, not here.
Each appliance is a separate Dante device on the network. The patchbox treats them as sources
like any other.

## Hardware Target

**Production:** Small always-on machine per area or per cluster of areas at the venue.
Eventually may have a touchscreen attached serving the web UI locally.

**Testing:** VM or physical node on 192.168.1.0/24 home network, with 2× Shure MXWANI8
(16ch analog output, 8ch each) as the Dante hardware test bench.

**Sizing target:** 7 areas × stereo = 14 TX outputs. Input count TBD based on sources per area.
2× Shure MXWANI8 covers the output side with 2 spare channels.

## Feature Requirements

### Phase 0 — Core routing (build this first, validate on real hardware)

- [ ] Appear on Dante network via Inferno as a single virtual device
- [ ] Configurable RX channel count (sources in)
- [ ] Configurable TX channel count (zone outputs)
- [ ] NxM routing matrix — any source to any output, many-to-many
- [ ] Per-input gain control (level each source independently)
- [ ] Per-output volume control (master level per zone)
- [ ] Single binary, browser UI served from same port
- [ ] Config persisted to TOML

### Phase 1 — DSP per output

- [ ] Per-output EQ (parametric, minimum 3-band)
- [ ] Per-output limiter (protect amps)
- [ ] DSP runs RT-safe in Inferno callback — no allocations in hot path

### Phase 2 — Zone UI and access control

- [ ] Zone-scoped URL routing (`/zone/<name>`)
- [ ] Per-zone view: source selector + volume fader only (bar staff)
- [ ] Admin view: full routing matrix + DSP settings
- [ ] PAM + JWT auth, role-based (admin / operator / zone-staff)
- [ ] WebSocket live metering

### Phase 3 — Scene management

- [ ] Scene presets (save/load full routing + DSP state)
- [ ] Named scenes (e.g. "Thursday student night", "Stage open", "Closed")
- [ ] Scene scheduler (optional)

### Phase 4 — Production hardening

- [ ] Watchdog + deploy script (same pattern as v1)
- [ ] Health endpoint
- [ ] mDNS registration
- [ ] Integration tests against real Dante hardware

## Design Principles

1. **Routing first** — get the matrix working on real hardware before adding DSP or UI polish
2. **Single binary** — axum + rust-embed, no npm, no separate server
3. **RT-safe audio path** — DSP in the Inferno callback, no allocations or locks in hot path
4. **Dynamic channel counts** — RX and TX channels configurable, not hardcoded
5. **Inferno as I/O** — one Dante virtual device per patchbox instance
6. **Generic** — no venue-specific assumptions baked in; config handles the specifics
7. **Test on real hardware early** — Shure MXWANI8 at home is the test bench, not just VMs

## What v1 Got Right (keep)

- Rust + axum + rust-embed architecture
- PAM + JWT auth with role-based access
- WebSocket live metering
- Zone-scoped URL routing
- Scene save/load (TOML)
- Watchdog + deploy script pattern
- IBM Plex Mono dark theme (consistent with inferno-iradio)

## What v1 Got Wrong (redo)

- Built without real requirements — features added blind
- DSP complexity (aux sends, VCA groups, noise gates) before routing was validated
- Never tested against real Dante hardware
- No per-input gain control
- Channel counts hardcoded in assumptions
- 30 autonomous sprints with no human review

## Reference Projects

| Repo | Role |
|------|------|
| `legopc/inferno-aoip-releases` | Appliance — provides the Dante I/O sources this patchbox routes |
| `teodly/inferno` (`inferno_aoip`) | Dante protocol library — the I/O layer |
| `legopc/inferno-iradio` | UI + architecture reference (axum, rust-embed, IBM Plex Mono) |
| `legopc/inferno-central` | Future management plane — will discover and monitor patchbox instances |

## Use Cases

### Background music distribution
Main bar Spotify appliance → patchbox → all zone outputs. Areas without local sources
subscribe to the main bar. Bar staff select source and adjust volume per zone.

### Stage / podium
Multiple instrument/mic inputs (via AUX-in appliances) → patchbox mixes to stereo →
TX pair subscribed to by AUX-out appliance → analog out to professional mixing panel
or directly to amp. Cheap appliance handles Dante ↔ analog conversion.

### Independent zones
Each area plays its own source. Patchbox handles routing independently per zone.
One area's appliance dying doesn't affect others.

### Event preset
Scene "Stage open" routes stage inputs to front-of-house and stage monitors.
Scene "Background" routes Spotify to all zones. Load with one click.

## Work Process Rules

1. **Read this file before any architectural decision.**
2. **Implement Phase 0 fully and test on real Dante hardware before starting Phase 1.**
3. **No improvement-roadmap generation until Phase 0 is working on hardware.**
4. **Every sprint reviewed by Jelle before merge — no autonomous implementation.**
5. **Update this file when scope or design decisions change.**
