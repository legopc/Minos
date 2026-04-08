# PROJECT CONTEXT
<!-- This file is the permanent source of truth for project intent.
     Read this before making any architectural decisions. -->

## What This Is

**dante-patchbox** is a production AoIP matrix mixer and DSP patchbay for a **pub sound system**.

## The Scenario

A pub with **~7 bars/areas**, each with its own speaker system and audio sources. Examples:
- Main bar, lounge, beer garden, sports bar, private room, stage area, DJ booth
- Each area may have: background music, a microphone, a local source (phone/laptop)

## Topology

```
                        ┌─────────────────────────────────────────────┐
                        │          CENTRAL SERVER                      │
                        │                                              │
                        │   patchbox (this application)               │
                        │   - NxM Dante matrix (all sources → all zones)│
                        │   - DSP per strip/bus (EQ, gain, ducking)   │
                        │   - Scene management (presets per event)    │
                        │   - REST + WebSocket API                    │
                        │   - Authentication (Phase 2+)               │
                        └──────────────────┬──────────────────────────┘
                                           │  Dante AoIP (IP network)
              ┌──────┬──────┬──────┬───────┴──┬──────┬──────┐
              │      │      │      │           │      │      │
           BAR 1   BAR 2  BAR 3  BAR 4      BAR 5  BAR 6  BAR 7
              │      │      │      │           │      │      │
         [ctrl pt][ctrl pt]...                               ...

Each bar control point:
- Web UI (tablet/screen at the bar) → same patchbox web UI, scoped to that bar's zone
- Can adjust: local volume, source selection for their zone
- Cannot (without auth): touch other bars' zones, adjust system-wide gains
```

## Feature Requirements (by phase)

### Phase 0 — Foundation (current)
- [x] Rust workspace scaffold
- [x] patchbox-core: NxM DSP matrix
- [x] patchbox-dante: inferno_aoip integration (feature-gated)
- [x] patchbox binary: axum REST API + WebSocket
- [x] Web UI: plain HTML/JS dark theme matrix patchbay
- [x] Scene save/load (TOML)
- [x] Systemd service

### Phase 1 — Real Audio
- [ ] End-to-end audio path: Dante RX → matrix → Dante TX
- [ ] TX ring buffer wiring (completes the inferno_aoip bridge)
- [ ] Per-zone VU meters live in UI

### Phase 2 — Multi-zone / Multi-bar UI
- [ ] Zone concept: group output channels into named zones (Bar 1, Bar 2, ...)
- [ ] Source concept: group input channels into named sources (BGM, Mic 1, ...)
- [ ] Zone-scoped web UI view: bar staff only see/control their zone
- [ ] URL-based zone routing: `/zone/bar-1` shows only Bar 1 controls

### Phase 3 — DSP per strip/bus
- [ ] Per-strip EQ (3-band parametric minimum)
- [ ] Per-strip compressor / limiter
- [ ] Ducking: BGM ducks when mic active
- [ ] Per-bus EQ

### Phase 4 — Authentication & access control
- [ ] JWT-based auth (login page)
- [ ] Roles:
  - `admin` — full access, all zones, system config
  - `operator` — all zones, no system config
  - `bar-staff` — own zone only (volume, source select)
  - `readonly` — view-only (useful for monitoring screens)
- [ ] Session tokens with expiry
- [ ] API endpoints annotated with required role

### Phase 5 — Production hardening
- [ ] cockpit-inferno integration (patchbox mode panel)
- [ ] Docker image + aarch64 cross-compile (for embedded server)
- [ ] Health monitoring endpoint for uptime checks
- [ ] Automatic failsafe: if server unreachable, bars fall back to unity gain
- [ ] Integration test suite
- [ ] TUI (ratatui) for local console management

## Design Principles

1. **Single binary** — one `patchbox` binary serves the web UI, API, and Dante bridge
2. **Zero npm / no build step** — web UI is plain HTML/JS/CSS, baked into the binary via `rust-embed`
3. **RT-safe audio path** — DSP runs in the inferno_aoip callback, no allocations or locks in hot path
4. **Idiomatic ecosystem** — matches inferno-iradio design patterns (AppState, axum, rust-embed, IBM Plex Mono theme)
5. **TOML config** — human-readable, git-friendly

## Work Process Rules

> **IMPORTANT — follow these exactly:**
>
> 1. **Implement all current planned todos before researching new improvements.**
>    Do NOT run the improvement-roadmap skill until the current sprint todos are done.
>
> 2. **Research improvements from the actual running state of the codebase.**
>    The roadmap reflects what's been built, not what was planned.
>    Run `improvement-roadmap` skill only when the current work is complete.
>
> 3. **After generating ~50 improvements in IMPROVEMENT_ROADMAP.md:**
>    Work through them in sprints (5–8 items per sprint).
>    Complete each sprint fully before starting the next.
>    Re-evaluate the roadmap after each sprint — priorities may shift.
>
> 4. **This file (`docs/PROJECT.md`) is the permanent project context.**
>    Read it at the start of any new session before making decisions.
>    Update it when the project scope or design decisions change.

## Reference Projects (in this ecosystem)

| Repo | Role |
|------|------|
| `legopc/inferno-iradio` | Direct template: axum + rust-embed + plain JS UI + IBM Plex Mono |
| `legopc/cockpit-inferno` | Cockpit panel — will get a patchbox mode |
| `teodly/inferno` (`inferno_aoip`) | The Dante protocol library |
| `legopc/Inferno_Dante_App` (local) | Existing `dante-control-rs` usage reference |

## Hardware Target

- **Server**: Linux x86_64 (EliteDesk) or aarch64 embedded
- **Control points**: Tablets or touchscreens at each bar running a browser
- **Audio I/O**: Dante AoIP — devices discovered via mDNS on local network
- **Clock**: PTP / statime daemon required for `inferno_aoip`
