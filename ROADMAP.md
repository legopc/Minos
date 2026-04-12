# Minos (dante-patchbox) — Roadmap

Dante AoIP software patchbay + DSP mixer. Single binary, HTTP API + WebSocket VU metering on `:9191`, PAM auth → JWT, config at `/etc/patchbox/config.toml`.

---

## Phase History

| Phase | Name | Description | Status |
|---|---|---|---|
| **0** | Core routing | Dante virtual device, NxM routing matrix, per-input gain, per-output volume, browser UI, TOML config persistence | ✅ Complete |
| **0.5** | Hardware hardening | Live Dante audio on Shure MXWANI8, RT-safe callback (SCHED\_FIFO 90), triple-buffer config hot path, event-driven wakeup, atomic config writes, graceful shutdown | ✅ Complete |
| **1** | DSP per output | 3-band parametric EQ + brick-wall limiter per output, latency tuned to ~2–3 ms, GR metering in web UI, idempotent Arch deploy script with statime | ✅ Complete |
| **2** | Zone UI + auth | Zone-scoped `/zone/:id` URL routing, per-zone view (bar staff), role-based JWT (admin/operator/zone-staff), WebSocket live metering | ✅ Complete |
| **3** | Scene management | Scene save/load (full routing + gain snapshot), named scenes, scene REST API | ✅ Complete |

---

## Upcoming

### `/health` endpoint — richer diagnostics
**Status:** ⏳ Basic endpoint exists (`GET /api/v1/health`) — returns `status`, version, channel counts. Dante connection state and PTP lock not yet exposed.

| Deliverable | Notes |
|---|---|
| Dante connection status | Is the Inferno device up and subscribed? |
| PTP lock state | Is statime synced? Read from `/tmp/ptp-usrvclock` socket |
| Active route count | How many matrix routes are non-zero |

Low effort, high value for monitoring and inferno-central integration.

---

### Scene scheduler
**Status:** ⏳ Planned — low priority

Time-based auto-recall of scenes (e.g. "Stage open at 20:00"). Scenes themselves work; scheduler does not exist yet.

---

### inferno-central integration
**Status:** ⏳ Waiting on inferno-central

Patchbox nodes can be identified by querying `/api/v1/health` — no additional mDNS record needed (Inferno already advertises the node on Dante mDNS).

---

## Cross-project Dependencies

| Dependency | Detail | Status |
|---|---|---|
| statime PTP | Unix socket `/tmp/ptp-usrvclock` | ✅ Running on dante-doos (192.168.1.25) |
| inferno-central | Fleet discovery via health endpoint | ⏳ inferno-central not yet built |

---

## Workspace Layout

```
dante-patchbox/
├── crates/
│   ├── patchbox-core/    # routing matrix, DSP (EQ + limiter), config types
│   ├── patchbox-dante/   # Inferno AoIP integration, RT audio callback
│   └── patchbox/         # binary: HTTP API, WebSocket, PAM/JWT auth
├── web/                  # browser UI (embedded in binary via rust-embed)
├── scripts/              # install-arch.sh — idempotent Arch deploy
├── config/               # statime.toml.example
└── config.toml.example
```
