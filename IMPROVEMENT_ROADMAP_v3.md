# dante-patchbox — Improvement Roadmap v3

> **Document type:** Engineering review and improvement backlog
> **Scope:** Web UI (mixer + patchbay depth), Auth (PAM.d), Zones, Performance, Reliability
> **Total items:** 50 (across 6 categories)
> **Generated:** April 2026 — evaluated against Sprint 21 deployed state (commit `06a79b3`)
> **Research basis:** 6 parallel research branches (structure, quality, security, reliability, web research, deps)
> **Next document:** IMPROVEMENT_ROADMAP_v4.md (generate after all v3 sprints complete)

---

## How to Read This Document

| Symbol | Meaning |
|--------|---------|
| 🔴 Critical | Blocking, broken, or security incident |
| 🟠 High | Significant operator pain or safety risk |
| 🟡 Medium | Clear benefit, not urgent |
| 🟢 Low | Polish, convenience, minor |
| Easy | <2 h, single file, obvious fix |
| Medium | Half-day, multiple files, some design |
| Hard | Multi-day, architecture change |

---

## Resolved Items (from v2)

All 54 v2 items resolved across Sprints 13–21. See `IMPROVEMENT_ROADMAP_v2.md` for full list.

---

## v3 Improvement Backlog (50 items)

### Category M — Mixer UX (14 items)

| ID | Title | Importance | Difficulty | Risk | Notes |
|----|-------|------------|------------|------|-------|
| M-01 | Vertical channel strip layout with tall CSS faders | 🟠 High | Hard | Medium | Redesign STRIPS view: CSS Grid columns 80–100px wide, fader 200px+ tall (top→bottom: name, pan, aux sends, fader, mute/solo, VU). Use `touch-action: none` on fader. Dual-gesture: 1-finger coarse, 2-finger pinch = 1/10th sensitivity. |
| M-02 | Pan/balance knob per input channel | 🟠 High | Medium | Medium | Frontend rotary knob (SVG or CSS conic-gradient). Add `POST /channels/input/:id/pan` backend endpoint + `pan: f32` field in `StripParams`. Range -1.0 (L) to +1.0 (R). Double-tap resets to centre. |
| M-03 | Aux send levels per input to each bus | 🟡 Medium | Hard | Medium | Per-input send-level slider to each named zone/bus. Collapsed by default (▸ AUX expand button). Stored in matrix gain at reserved aux rows. Requires "aux bus" concept in patchbox-core. |
| M-04 | VCA/DCA group faders | 🟡 Medium | Hard | Medium | UI to assign channels to a named group. Group master fader scales member channels proportionally. Store in `patchbox-vca-groups` localStorage. Frontend-only initially (scale gains via API calls). |
| M-05 | Pre/post fader send toggle per aux send | 🟡 Medium | Medium | Medium | Small PRE/POST button per aux send slot. Pre-fader: send level independent of channel fader. Post-fader: send follows channel fader movement. Stored in `StripParams.aux_pre_post: Vec<bool>`. |
| M-06 | AFL/PFL solo mode global toggle | 🟡 Medium | Easy | Low | Toolbar toggle button AFL / PFL. AFL (After Fader Listen) routes post-fader signal to monitor; PFL routes pre-fader. Stored in `patchbox-solo-mode` localStorage. Affects solo bus routing logic. |
| M-07 | Input gain staging display | 🟡 Medium | Medium | Low | Show two gain indicators per strip: `TRIM` (hardware input trim, `gain_trim`) and `FADER` (matrix gain). Visual gain-structure bar so engineers can see headroom. Tooltip shows combined gain in dB. |
| M-08 | Visual EQ frequency response curve | 🟠 High | Medium | Low | Draw combined frequency response curve on EQ modal canvas (200×80px). Use biquad transfer function math per band. Update on every slider change. Makes EQ settings immediately readable to non-engineers. |
| M-09 | Compressor gain reduction graph | 🟡 Medium | Medium | Low | Rolling 3s GR history waveform on compressor modal canvas. Static threshold/ratio line overlay. Draw input level dot. Requires backend to push per-channel GR values over WS. |
| M-10 | HPF quick toggle per channel | 🟡 Medium | Easy | Low | 80 Hz high-pass filter button (⊣) in channel strip. Toggles `StripParams.hpf_enabled: bool`. Backend applies 2nd-order Butterworth via dasp biquad. Essential for mic channels in pub environment. |
| M-11 | Noise gate per channel | 🟡 Medium | Medium | Medium | Threshold gate toggle in strip + threshold slider (-80 to -20 dBFS). Open/closed indicator LED. `StripParams.gate_threshold: Option<f32>`. Useful for muting silent mic channels during service. |
| M-12 | Channel meters embedded in strip view | 🟠 High | Medium | Low | Mini canvas VU meter (12×80px vertical) inside each channel strip column. Reads from existing meter state. Shows both RMS (green) and peak (amber). No extra WS traffic needed. |
| M-13 | Insert bypass toggle (all DSP) | 🟡 Medium | Easy | Low | Single `⊘ BYPASS` button per channel. Sets `StripParams.dsp_bypass: bool`. Backend skips EQ + compressor + gate processing. Useful for A/B comparison during sound check. |
| M-14 | Bus master fader per zone | 🟡 Medium | Medium | Low | Zone-level master fader that proportionally scales all output channels in the zone. Separate from per-channel `master_gain`. Stored in zone config. Gives bar staff a single volume control. |

---

### Category P — Patchbay UX (10 items)

| ID | Title | Importance | Difficulty | Risk | Notes |
|----|-------|------------|------------|------|-------|
| P-01 | Dante subscription status overlay per cell | 🔴 Critical | Hard | Medium | Each matrix cell shows 4 states: Unrouted (empty), Pending (spinner), Active (green dot), Error (red ✕). Poll `GET /api/v1/dante/subscriptions` every 5s. Requires backend endpoint exposing inferno_aoip subscription state. |
| P-02 | Source/destination tree browser | 🟠 High | Hard | Medium | Collapsible sidebar listing channels grouped by Dante device name (not flat index). Click channel in tree to highlight row/column in matrix. Replace flat numeric headers with device-grouped headers. |
| P-03 | Patchbay connection search/filter | 🟠 High | Easy | Low | Search input above matrix. Filters visible rows AND columns to names matching query. Uses existing `escHtml` names. Debounced 150ms. Shows "N of M inputs match" count. |
| P-04 | Broken/lost connection indicator | 🟠 High | Medium | Low | When Dante RX loss detected, flash affected cell red + emit toast + add to notification center. Backend pushes `{"op":"dante_rx_loss","input":N}` over WS. Frontend adds `.cell-rx-lost` CSS class. |
| P-05 | Batch connect operation | 🟡 Medium | Medium | Low | Toolbar button "Connect selected inputs to zone". Multi-select input rows (checkbox column), then choose target zone from dropdown. Fires PATCH /matrix/:i/:o for each combination. |
| P-06 | Routing templates (matrix-only presets) | 🟡 Medium | Medium | Low | Named presets that save/restore only matrix routing (not DSP). Separate from full scenes. `GET/POST /routing-templates` backend. Useful for "Stage setup" vs "BGM only" quick switches. |
| P-07 | Connection export (JSON/CSV download) | 🟢 Low | Easy | Low | Export button in patchbay toolbar. Downloads current matrix as CSV (`input,output,gain_db`) or JSON. Client-side generation from `state.matrix`. No backend needed. |
| P-08 | Cell hover tooltip with signal level + latency | 🟡 Medium | Easy | Low | Tooltip on 300ms hover: shows current gain dB, input signal level (from meters state), and Dante latency if available. Uses existing `showGainTooltip` pattern, extended with signal data. |
| P-09 | Spider/cable view mode | 🟢 Low | Hard | Low | Toggle to SVG spider view: left column = inputs, right column = outputs, bezier curves for active connections coloured by input index. For non-technical bar owners. Store preference in localStorage. |
| P-10 | Lock specific connections | 🟡 Medium | Easy | Low | Right-click cell → "Lock connection". Locked cells show padlock icon, ignore clicks, persist in `patchbox-locked-cells` localStorage. Admin UI shows locked state. Prevents accidental re-routeing during service. |

---

### Category Z — Zones / Multi-bar (6 items)

| ID | Title | Importance | Difficulty | Risk | Notes |
|----|-------|------------|------------|------|-------|
| Z-01 | URL-based zone routing `/zone/:id` | 🔴 Critical | Medium | Medium | `/zone/bar-1` scopes the entire UI to that zone's channels. Bar staff bookmark their URL on install. Uses hash routing or `URLSearchParams`. Combines with auth (A-02) for role-based redirect on login. |
| Z-02 | Per-zone master volume fader | 🟠 High | Medium | Low | Large master fader in zone view that scales all outputs in the zone proportionally. `PATCH /zones/:id/master_gain`. The primary "turn the bar down" control for bar staff. |
| Z-03 | Zone source selector | 🟠 High | Medium | Low | Large-button picker in zone view: choose active source for zone (BGM / Mic / Line / Silence). Sets the routing for that zone's channels. `PATCH /zones/:id/source`. |
| Z-04 | Zone presets (independent of global scenes) | 🟡 Medium | Medium | Low | Per-zone save/load: "Happy Hour", "Night", "Closed". `GET/POST /zones/:id/presets`. Bar staff recall their zone preset without affecting other zones. |
| Z-05 | Zone lockout (admin locks a zone) | 🟡 Medium | Easy | Low | Admin toggle in zone overview: locked zone shows padlock, rejects gain/mute changes from non-admin clients. `PATCH /zones/:id/locked` returns 403 to locked-zone change attempts. |
| Z-06 | Visual zone floor plan layout | 🟢 Low | Hard | Low | Simple floor plan editor: drag zone cards onto a grid background representing the pub layout. Stored in `patchbox-floor-plan` localStorage. Overview mode shows live VU meters on the floor plan. |

---

### Category A — Auth & Access Control (5 items)

| ID | Title | Importance | Difficulty | Risk | Notes |
|----|-------|------------|------------|------|-------|
| A-01 | PAM.d login with JWT issuance | 🔴 Critical | Hard | High | Login page (`POST /login`): authenticate against Linux PAM (`pam` crate in `spawn_blocking`). Isolate as setuid helper binary over Unix socket. Map Linux groups to roles: `patchbox-admin`→Admin, `patchbox-operator`→Operator, `patchbox-bar-N`→BarStaff(zone N) via `nix::unistd::getgrouplist`. Issue RS256 JWT (`jsonwebtoken`). Store private key at `/etc/patchbox/jwt.key` (0600). Rate-limit `/login`: 5 req/min per IP via tower-governor. |
| A-02 | Zone-scoped bar-staff view | 🔴 Critical | Medium | Medium | After login as BarStaff, redirect to `/zone/:assigned_zone`. JWT contains `zone` claim. All API write calls from BarStaff role validated against their assigned zone. Middleware extracts JWT and enforces zone restriction. |
| A-03 | Enforce RBAC on all API routes | 🔴 Critical | Medium | High | `role_from_request()` is defined but **never called** — RBAC completely unenforced. Add middleware extractor on every route. Admin: full access. Operator: all zones, no user management. BarStaff: own zone gains/mutes only. ReadOnly: GET only. |
| A-04 | WebSocket JWT authentication | 🟠 High | Medium | Medium | Require JWT token in WS upgrade request (query param `?token=` or `Authorization` header). Reject unauthenticated WS connections with 401. Scope WS meter broadcasts to authorized channels only for BarStaff. |
| A-05 | Session timeout + auto-logout | 🟡 Medium | Easy | Low | JWT `exp` claim set to 8 hours (one bar shift). Frontend checks `exp` on page focus; shows "Session expired" overlay. Refresh token endpoint (`POST /refresh`) extends session without re-entering password. |

---

### Category T — Performance & Architecture (9 items)

| ID | Title | Importance | Difficulty | Risk | Notes |
|----|-------|------------|------------|------|-------|
| T-01 | Binary WebSocket meter protocol | 🟠 High | Medium | Medium | Replace JSON meter updates with packed binary frames: 1-byte type prefix (0x01=meters) + two `i16` per channel (rms_i16, peak_i16 in millibels = dBFS×100). 64ch = 257 bytes vs ~2KB JSON. `Arc<Bytes>` broadcast — single serialisation per tick. |
| T-02 | Multiplex WS message types via type prefix | 🟡 Medium | Easy | Low | 1-byte type prefix on all WS binary frames: `0x01`=meters, `0x02`=state diff, `0x03`=heartbeat, `0x04`=dante_event. Client dispatches on first byte. Future-proof protocol evolution. |
| T-03 | Virtual scrolling for large matrices | 🟡 Medium | Hard | Medium | Transparent `<div>` spacer sized to `rows*cellSize × cols*cellSize` for native scrollbars. On scroll: compute `firstVisibleRow`, render only visible rows + 1 buffer. Supports 128-channel matrices without DOM bloat. |
| T-04 | OffscreenCanvas Web Worker for matrix renderer | 🟢 Low | Hard | Low | Transfer matrix canvas to Web Worker via `OffscreenCanvas.transferControlToOffscreen()`. Worker receives scroll + state diffs via `postMessage`, redraws, commits. Main thread stays jank-free for touch events. |
| T-05 | Flat `Uint8Array` routing state + delta patches | 🟡 Medium | Medium | Low | Replace `state.matrix` 2D array with `Uint8Array(nIn * nOut)` for cache-friendly access. Server sends delta patches `[{index, value}]` on change instead of full state. |
| T-06 | Screen Wake Lock for bar tablets | 🟠 High | Easy | Low | `navigator.wakeLock.request('screen')` on page load, re-request on `visibilitychange`. Prevents bar tablets from sleeping during service. Add to `boot()` with graceful fallback. |
| T-07 | Auto-persist matrix state on shutdown | 🟠 High | Medium | Low | On SIGTERM, save current matrix state as `_autosave.toml` before shutdown. On startup, offer to restore from autosave if found. Currently matrix state is **lost on restart**. |
| T-08 | Add `cargo audit` + `cargo-deny` to CI | 🟡 Medium | Easy | Low | `cargo audit` scans for CVEs. `cargo-deny` enforces license policy and blocks duplicate deps. Add as CI step on every push. |
| T-09 | Fix `inferno_aoip` git commit pin | 🟡 Medium | Easy | Medium | `inferno_aoip` pinned to `rev = "3f2bf142e15d"` — breaks if upstream rebases. Switch to version tag or branch pin. Coordinate with inferno maintainer to publish a crate version. |

---

### Category U — Polish & Completeness (6 items)

| ID | Title | Importance | Difficulty | Risk | Notes |
|----|-------|------------|------------|------|-------|
| U-01 | Notification center (event log panel) | 🟠 High | Medium | Low | Side panel (▶ toolbar) with scrollable log: clip latches, Dante RX loss, scene loads, auth events, zone locks. Each entry has timestamp, icon, message. Max 200 entries (circular buffer). |
| U-02 | Undo history panel | 🟡 Medium | Medium | Low | Visual panel showing last N undo operations by description. Click entry to restore to that snapshot. Uses existing `undoStack`. |
| U-03 | Keyboard shortcut reference modal | 🟡 Medium | Easy | Low | Press `?` opens modal listing all shortcuts with actions. Auto-generated from a `SHORTCUTS` map object. |
| U-04 | Dante health banner | 🟠 High | Medium | Medium | Persistent top banner: device count, unresolved subscriptions, clock master name, sample rate. Green/amber/red dot. Requires backend `/api/v1/dante/health` endpoint. |
| U-05 | Scene diff view | 🟡 Medium | Medium | Low | "Compare" button in scene dropdown shows what would change (gains, mutes, routes) before confirming load. Diff rendered as highlighted rows in modal table. |
| U-06 | Auto scene backup on overwrite | 🟡 Medium | Easy | Low | When saving a scene that already exists, copy current version to `{name}.bak.toml` before overwriting. List `.bak` files in a "Backups" section of scene dropdown. One backup per name. |

---

## Recommended Sprint Sequencing (Sprints 22–30)

| Sprint | Theme | Items | Backend changes? |
|--------|-------|-------|-----------------|
| **Sprint 22** | Mixer core — vertical strips + meters in strips | M-01, M-06, M-07, M-12 | No |
| **Sprint 23** | Patchbay intelligence | P-03, P-04, P-08, P-10 | Minor (WS event) |
| **Sprint 24** | Pan + DSP visuals | M-02, M-08, M-09, M-10 | Yes (pan endpoint, HPF) |
| **Sprint 25** | Zone multi-bar UX | Z-01, Z-02, Z-03, Z-04 | Yes (zone endpoints) |
| **Sprint 26** | PAM.d auth + RBAC enforcement | A-01, A-02, A-03, A-04 | Yes (major — auth layer) |
| **Sprint 27** | Patchbay advanced | P-01, P-02, P-05, P-06 | Yes (Dante status endpoint) |
| **Sprint 28** | Mixer advanced — aux + VCA + gate | M-03, M-04, M-11, M-13 | Yes (gate endpoint) |
| **Sprint 29** | Performance + reliability | T-01, T-02, T-06, T-07 | Yes (binary WS, autosave) |
| **Sprint 30** | Polish + completeness | U-01, U-02, U-03, U-04, U-06 | Minor |

---

## Key Findings from Research Branches

### Security (Branch C — Critical)
- **CRITICAL**: `role_from_request()` defined but **never called** — RBAC completely unenforced (A-03 fixes)
- **CRITICAL**: WebSocket accepts unauthenticated connections — no token required for `/ws` (A-04 fixes)
- **HIGH**: Default CORS config allows all origins — `CorsLayer::new()` with no restrictions
- No PAM auth yet — A-01 is the entry point for the entire auth layer

### Reliability (Branch D)
- Matrix state **not persisted** on restart — must manually save as scene (T-07 fixes)
- No scene auto-backup — corruption is unrecoverable (U-06 fixes)
- Prometheus metrics minimal (3 gauges only — missing DSP stats, HTTP request rates)
- Zone config not validated at startup — invalid output indices cause runtime 404

### Code Quality (Branch B)
- `.unwrap()` panic risks: `routes.rs:137,187`, `assets.rs:44,56,60`
- `fanOutInput` silently discards errors via `.catch(() => {})`
- Phase invert (W-07) is frontend-only — backend endpoint still missing (TODO at `app.js:1817`)
- CSS `!important` overrides in kiosk/HC theme sections need refactor

### Dependencies (Branch F)
- `inferno_aoip` pinned to git commit SHA — breaks on upstream rebase (T-09)
- No `cargo audit` or `cargo-deny` in CI (T-08)
- No doc comments on public structs `Config`, `AppState`, `Role`, `build_router`
- Build: 0.5s incremental, 8.8MB binary, LTO+strip+panic=abort — well optimised

### Web Research (Branch E)
- PAM sidecar pattern: isolate auth to setuid helper over Unix socket (security best practice)
- WS binary meters: 4 bytes/channel (two i16 millibels) — 64ch = 257 bytes vs ~2KB JSON
- Screen Wake Lock API critical for bar tablets (prevents sleep during service)
- OffscreenCanvas + Web Worker for matrix rendering eliminates main-thread jank
- Log curve for fader: `dB = 20 * log10(pos^2.5)` — never linear mapping

---

## Dependency Map

```
A-01 (PAM login)      → A-02 (zone scope), A-03 (RBAC), A-04 (WS auth)
A-03 (RBAC enforce)   → Z-05 (zone lockout)
Z-01 (URL routing)    → Z-02, Z-03, Z-04 (zone controls)
M-01 (vert strips)    → M-03 (aux sends), M-04 (VCA), M-12 (strip meters)
P-01 (Dante status)   → P-04 (RX loss indicator), P-02 (tree browser)
T-01 (binary WS)      → T-02 (type prefix)
T-03 (virtual scroll) → T-04 (OffscreenCanvas worker)
```
