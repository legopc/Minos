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
- [x] End-to-end audio path: Dante RX → matrix → Dante TX (Sprint 12, D-01)
- [x] TX ring buffer wiring — transmit_from_external_buffer with atomic buffers (Sprint 12)
- [x] Dante RX subscription/activity indicator (Sprint 12, D-04)
- [x] Per-zone VU meters live in UI (meters written from callback)

### Phase 2 — Multi-zone / Multi-bar UI
- [ ] Zone concept: group output channels into named zones (Bar 1, Bar 2, ...)
- [ ] Source concept: group input channels into named sources (BGM, Mic 1, ...)
- [ ] Zone-scoped web UI view: bar staff only see/control their zone
- [ ] URL-based zone routing: `/zone/bar-1` shows only Bar 1 controls

### Phase 3 — DSP per strip/bus
- [x] Per-strip EQ — 4-band parametric biquad (Sprint 11, D-05)
- [x] Per-strip/bus compressor / limiter (Sprint 11, D-06)
- [ ] Ducking: BGM ducks when mic active
- [ ] Per-bus EQ (additional bands)

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

## Sprint Status (updated after each sprint)

| Sprint | Items | Status | Commit |
|--------|-------|--------|--------|
| Sprint 1 | BUG-01, BUG-02, S-02, R-01, R-03 | ✅ Done | — |
| Sprint 2 | BUG-03, BUG-04, S-07, R-06, O-07 | ✅ Done | — |
| Sprint 3 | S-06, S-08, R-07, R-05, U-07, O-03 | ✅ Done | — |
| Sprint 4 | R-08, R-02, R-09, R-10, U-03 | ✅ Done | — |
| Sprint 5 | U-04, U-08, U-02, T-01, T-03/T-05 | ✅ Done | — |
| Sprint 6 | U-01 (zone URL), D-09 (mDNS), S-01 (API key), D-03 (names) | ✅ Done | — |
| Sprint 7 | S-01 (JWT), S-03 (rate limit), S-05 (RBAC), D-02 (PTP) | ✅ Done | — |
| Sprint 8 | O-01, O-02, O-04, O-06, O-08, T-02 | ✅ Done | — |
| Sprint 9 | R-04, R-11, R-12, R-13 | ✅ Done | — |
| Sprint 10 | O-05, U-05, U-06, T-04 | ✅ Done | 5e5aade |
| Sprint 11 | D-05, D-06, U-09 | ✅ Done | 8dec442 |
| Sprint 12 | D-01, D-04, D-10 | ✅ Done | af74401 |
| Sprint 13 | BUG-W01–04, W-41, W-43, W-44, W-47, W-52 (security + bugs) | ✅ Done | 8e6963a |
| Sprint 14 | W-04, W-05, W-16–18, W-21–22 (touch/mobile) | ✅ Done | af2d3a1 |
| Sprint 15 | W-10, W-11, W-13, W-15, W-24 (zones/views) | ✅ Done | 5f5723d |
| Sprint 16 | W-02, W-03, W-09, W-55, W-56, W-59 (amber redesign) | ✅ Done | b6a181c |
| Sprint 17 | W-07, W-08, W-12, W-14 (phase, stereo link, fan-out, bulk select) | ✅ Done | 14aab70 |
| Sprint 18 | W-30–35 (metering: clip latch, RMS, gradient cache, peak decay, master L/R) | ✅ Done | 50a5660 |
| Sprint 19 | W-23, W-25, W-26 (zone overview, groups, scheduler) | ✅ Done | 9d8b243 |
| Sprint 20 | W-45, W-46, W-49, W-50 (perf fingerprint, GPU faders, PWA) | ✅ Done | bdf6ad5 |
| Sprint 21 | W-36–40, W-57–58 (ARIA, focus trap, HC theme, onboarding) | ✅ Done | 962ef86 |
| **Next** | Generate new improvement roadmap (v3) — evaluate current state | 🔜 Planned | — |

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
