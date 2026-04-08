# Changelog

All notable changes to dante-patchbox are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- S-03: Global rate limiting via `tower_governor` (200 burst / 20 req/s sustained)
- S-05: RBAC role system — Admin / Operator / BarStaff / ReadOnly injected per API key
- D-02: PTP/statime health check in `/api/v1/health` (`ptp_ok`, `ptp_offset_ns` fields)
- O-01: aarch64 cross-compile target in CI (EliteDesk ARM / Raspberry Pi)
- O-02: Automated GitHub Releases workflow on version tags
- O-04: MSRV declared as `1.80` in workspace `Cargo.toml`

---

## [0.1.0] — Sprint 1–7 Baseline

### Added

#### Sprint 1 — Security & Stability Baseline
- BUG-01: Scene file name sanitisation — path traversal prevented
- BUG-02: WebSocket message size limit (1 MiB max)
- S-02: CORS restricted to configured origins (same-origin default)
- R-01: systemd `sd_notify` watchdog heartbeat (optional `systemd` feature)
- R-03: PID lock file — prevents duplicate instances and scene file corruption

#### Sprint 2 — Input Hardening + Atomics
- BUG-03: Matrix cell gain clamped to `[0.0, 4.0]` at API layer (+12 dB max)
- BUG-04: Channel name max length 64 chars; invalid characters scrubbed
- S-07: Internal error details stripped from 500 responses
- R-06: Atomic scene writes (write to `.toml.tmp` + `rename`)
- O-07: `inferno_aoip` git dependency pinned to a specific commit hash

#### Sprint 3 — WebSocket Hardening + Build
- S-06: WebSocket upgrade origin validation
- S-08: WebSocket connection cap (20 global) — returns 429 when exceeded
- R-07: WebSocket backpressure — 50 ms send timeout, slow clients dropped
- R-05: Config validation at startup with clear human-readable errors
- U-07: JavaScript WebSocket reconnect with exponential backoff + jitter
- O-03: LTO + binary stripping in release Cargo profile (~3.4 MB binary)

#### Sprint 4 — Observability
- R-08: Structured JSON logging option (`RUST_LOG_FORMAT=json`)
- R-02: Deep health check — uptime, WS connections, scenes dir writability
- R-09: Prometheus metrics exporter on `port+1` (`patchbox_ws_connections`, `patchbox_uptime_seconds`)
- R-10: Graceful Dante unsubscribe on SIGTERM via `tokio::select!` + `Arc<Notify>`
- U-03: Matrix cell gain tooltip showing dB value; `−∞` label for silence

#### Sprint 5 — Web UI Polish
- U-04: Mobile/tablet responsive layout — 48 px touch targets, `@media (max-width:900px)`
- U-08: Canvas VU meters with peak-hold decay (green→orange→red gradient)
- U-02: Keyboard navigation — arrow keys move focus, Enter/Space toggle, m=mute, s=solo
- T-01: WebSocket integration test (real TCP listener, `tokio-tungstenite`)
- T-03: Scene roundtrip test; T-05: `schema_version` field with serde default for backward compat

#### Sprint 6 — Zone / Multi-bar UI
- U-01: Zone API — `GET /api/v1/zones` + `GET /api/v1/zones/:id` with filtered matrix slice
- S-01: API key authentication middleware (`X-Api-Key` / `Authorization: Bearer`)
- D-09: mDNS/DNS-SD registration (`_http._tcp`, `_dante-patchbox._tcp`) via `mdns-sd`
- D-03: Dante device name + channel counts announced as mDNS TXT records

#### Sprint 7 — Auth + RBAC + PTP Health
- S-03: `tower_governor` global rate limiting
- S-05: `Role` enum (Admin/Operator/BarStaff/ReadOnly) per API key; injected as axum extension
- D-02: statime PTP daemon health check — `/run/statime/offset` read + `/proc` fallback

---

[Unreleased]: https://github.com/legopc/dante-patchbox/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/legopc/dante-patchbox/releases/tag/v0.1.0
