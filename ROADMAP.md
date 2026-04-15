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

## UI Sprint History

| Sprint | Delivered |
|---|---|
| **Sprint 1** | Dark SPA shell, Matrix tab skeleton, Mixer tab skeleton, WebSocket VU backbone |
| **Sprint 2** | Monitor bus backend, RT-safe solo/mute/polarity in DSP callback |
| **Sprint 3** | Matrix crosspoint level glow (orange/amber dots), VU meters with dB scale markings (0/−10/−20/−40 dBFS), solo/mute/polarity buttons on input strips (mixer), DSP badge buttons on matrix rows |
| **Sprint 4** | Input channel rename (double-click ch-name in matrix), output column rename (double-click angled header), resizable input label column (drag right edge, 8 px hit zone), angled output column headers (−60 deg, left-aligned origin), DSP badge sizing (matrix vs mixer distinction) |

---

## Upcoming Backlog

| Item | Description | Priority |
|---|---|---|
| EQ curve canvas | Visual frequency response curve on parametric EQ panel | Medium |
| GR meters | Gain reduction meters on compressor/limiter/gate DSP panels | Medium |
| Scene modal | Save-as dialog, rename, confirm-on-recall | Medium |
| Matrix keyboard nav | Arrow keys to move focus, Enter to toggle crosspoint | Low |
| Internal buses | Named submix buses: route any RX inputs into a virtual group channel with its own DSP chain (EQ/gate/limiter), output appears as a new input row in the matrix routable to any TX. Enables group processing (e.g. "Band Bus" — compress guitar+bass+keys together before zoning). Requires new `InternalBus` entity in config + RT audio engine + matrix UI virtual rows. | High |
| AFL/PFL solo | Monitor bus routing to dedicated output (backend + UI) | Medium |
| `/health` enrichment | Add Dante connection state, PTP lock status, active route count | Low |
| Scene scheduler | Time-based auto-recall (e.g. "Stage open at 20:00") | Low |

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
