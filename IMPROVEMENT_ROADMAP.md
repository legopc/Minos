# dante-patchbox — Improvement Roadmap

> **Document type:** Engineering review and improvement backlog  
> **Scope:** Full-stack Rust AoIP matrix mixer — Dante I/O, DSP core, axum REST/WS API, vanilla web UI, TUI, Docker/systemd  
> **Total items:** 58 (4 bug fixes + 54 improvements) — 28 resolved (Sprints 1–6), 30 open  
> **Generated:** July 2025; updated after Sprint 6 (April 2026)  
> **Basis:** Research branches A–F (codebase structure, code quality, security, ops/reliability, web research, build hygiene) against commit `e30cba6`

---

## Resolved Items (28) — Sprints 1–6

| ID | Title | Sprint |
|----|-------|--------|
| BUG-01 | Scene path traversal fix | Sprint 1 |
| BUG-02 | WebSocket message size limit | Sprint 1 |
| S-02 | Restrict CORS origins | Sprint 1 |
| R-01 | Systemd watchdog | Sprint 1 |
| R-03 | PID lock file | Sprint 1 |
| BUG-03 | Clamp matrix cell gain at API layer | Sprint 2 |
| BUG-04 | Channel name max length 64 chars | Sprint 2 |
| S-07 | Scrub error messages from 500 responses | Sprint 2 |
| R-06 | Atomic scene writes | Sprint 2 |
| O-07 | Pin inferno_aoip git dep to commit hash | Sprint 2 |
| S-06 | WebSocket origin validation | Sprint 3 |
| S-08 | WebSocket connection limit | Sprint 3 |
| R-07 | WS backpressure — timeout + drop slow clients | Sprint 3 |
| R-05 | Config validation at startup | Sprint 3 |
| U-07 | JS WebSocket reconnect with exponential backoff | Sprint 3 |
| O-03 | LTO + strip in release profile | Sprint 3 |
| R-08 | Structured JSON logging | Sprint 4 |
| R-02 | Deep health check | Sprint 4 |
| R-09 | Prometheus /metrics exporter | Sprint 4 |
| R-10 | Graceful Dante unsubscribe on SIGTERM | Sprint 4 |
| U-03 | Matrix cell gain tooltip (dB) | Sprint 4 |
| U-04 | Mobile/tablet responsive layout | Sprint 5 |
| U-08 | Canvas VU peak-hold indicator | Sprint 5 |
| U-02 | Keyboard shortcuts (arrow nav, m=mute, s=solo) | Sprint 5 |
| T-01 | WebSocket integration test | Sprint 5 |
| T-03 | Scene roundtrip test | Sprint 5 |
| T-05 | Scene schema_version field | Sprint 5 |
| S-01 | API key authentication middleware | Sprint 6 |
| U-01 | Zone/bar-scoped view + zone API | Sprint 6 |
| D-09 | mDNS/DNS-SD registration | Sprint 6 |
| D-03 | Dante device name + channel TXT records | Sprint 6 |

---

## How to Read This Document

### Scoring

| Axis | Levels |
|------|--------|
| **Importance** | 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low |
| **Difficulty** | Easy (<2h) · Medium (half-day) · Hard (multi-day) |
| **Risk** | Low · Medium · High |
| **Prerequisites** | Item IDs that must complete first |

### Process Rule

> **Do NOT generate new improvements until all current sprint todos are done.**  
> Work improvements in sprints of 5–8 items. Complete each sprint, redeploy, then start the next.  
> This document is the authoritative backlog; update it (mark resolved) after each sprint.

---

## Executive Summary

| ID | Category | Title | Importance | Difficulty | Risk | Prerequisites |
|----|----------|-------|------------|------------|------|---------------|
| BUG-01 | Security | Scene path traversal — sanitise file names | 🔴 Critical | Easy | Low | None |
| BUG-02 | Security | WebSocket message size unbounded — DOS vector | 🔴 Critical | Easy | Low | None |
| BUG-03 | Code Quality | Matrix cell gain not clamped at API layer | 🟠 High | Easy | Low | None |
| BUG-04 | Code Quality | Channel name has no length limit | 🟠 High | Easy | Low | None |
| S-01 | Security | API key authentication (bearer token middleware) | 🔴 Critical | Medium | Medium | None |
| S-02 | Security | Restrict CORS to known origins | 🔴 Critical | Easy | Low | None |
| S-03 | Security | Rate limiting on REST + WebSocket endpoints | 🔴 Critical | Medium | Low | None |
| S-04 | Security | TLS termination (rustls + self-signed or reverse proxy) | 🔴 Critical | Medium | Medium | S-01 |
| S-05 | Security | Role-based access control (admin / operator / bar-staff / readonly) | 🟠 High | Hard | Medium | S-01 |
| S-06 | Security | WebSocket origin validation | 🟠 High | Easy | Low | None |
| S-07 | Security | Scrub error messages from 500 responses | 🟠 High | Easy | Low | None |
| S-08 | Security | WebSocket client connection limit | 🟠 High | Easy | Low | None |
| R-01 | Reliability | Systemd watchdog (WatchdogSec + sd_notify heartbeat) | 🔴 Critical | Easy | Low | None |
| R-02 | Reliability | Deep health check (Dante device status, scenes dir writable) | 🔴 Critical | Easy | Low | None |
| R-03 | Reliability | PID lock file — prevent duplicate instances + scene corruption | 🔴 Critical | Easy | Low | None |
| R-04 | Reliability | Dante device auto-reconnect on failure | 🟠 High | Medium | Medium | None |
| R-05 | Reliability | Config validation at startup with hard-fail option | 🟠 High | Easy | Low | None |
| R-06 | Reliability | Atomic scene file writes (write-then-rename) | 🟠 High | Easy | Low | None |
| R-07 | Reliability | WebSocket backpressure — drop slow clients, not queue | 🟠 High | Easy | Low | None |
| R-08 | Reliability | Structured JSON logging (tracing-subscriber JSON layer) | 🟡 Medium | Easy | Low | None |
| R-09 | Reliability | Prometheus metrics endpoint | 🟡 Medium | Medium | Low | None |
| R-10 | Reliability | Graceful Dante device shutdown on SIGTERM | 🟡 Medium | Easy | Low | None |
| O-01 | Ops | aarch64 cross-compile CI matrix (EliteDesk ARM / Raspberry Pi) | 🟠 High | Medium | Low | None |
| O-02 | Ops | GitHub Releases automation (tag → release + artifact upload) | 🟡 Medium | Easy | Low | None |
| O-03 | Ops | Binary stripping + LTO in release profile | 🟡 Medium | Easy | Low | None |
| O-04 | Ops | MSRV declaration + CI pin | 🟡 Medium | Easy | Low | None |
| O-05 | Ops | OCI image labels (version, source, description) | 🟢 Low | Easy | Low | None |
| O-06 | Ops | Changelog + semantic versioning | 🟡 Medium | Easy | Low | None |
| O-07 | Ops | inferno_aoip git dep pinned to commit hash | 🟠 High | Easy | Low | None |
| O-08 | Ops | README: prerequisites, install, troubleshooting, TUI docs | 🟡 Medium | Easy | Low | None |
| D-01 | Dante / Audio | Dante TX path — wire transmit ring buffers (TODO in device.rs) | 🔴 Critical | Hard | High | None |
| D-02 | Dante / Audio | statime PTP daemon health check integration | 🔴 Critical | Medium | Medium | R-01 |
| D-03 | Dante / Audio | Dante device-name and channel-name announced on network | 🟠 High | Medium | Medium | D-01 |
| D-04 | Dante / Audio | Dante Controller subscription status in web UI | 🟡 Medium | Medium | Medium | D-01 |
| D-05 | Dante / Audio | DSP: parametric EQ per input strip (fundsp biquad) | 🟡 Medium | Hard | Medium | None |
| D-06 | Dante / Audio | DSP: compressor/limiter per output bus | 🟡 Medium | Hard | Medium | None |
| D-07 | Dante / Audio | DSP: loudness normalisation (EBU R128 metering) | 🟢 Low | Hard | Medium | D-05 |
| D-08 | Dante / Audio | Sample-accurate latency measurement on RX→TX path | 🟡 Medium | Hard | High | D-01 |
| U-01 | Web UI | Zone/bar-scoped view — show only assigned inputs/outputs per bar | 🔴 Critical | Medium | Low | S-05 |
| U-02 | Web UI | Keyboard shortcuts (M=mute, S=solo, arrows=fine gain) | 🟡 Medium | Easy | Low | None |
| U-03 | Web UI | Matrix cell right-click gain tooltip — show dB value in real time | 🟡 Medium | Easy | Low | None |
| U-04 | Web UI | Mobile/tablet responsive layout (min 768px grid collapse) | 🟠 High | Medium | Low | None |
| U-05 | Web UI | Undo/redo stack for matrix changes | 🟡 Medium | Medium | Low | None |
| U-06 | Web UI | Scene diff view — compare current state vs saved scene | 🟢 Low | Medium | Low | None |
| U-07 | Web UI | WebSocket reconnect with exponential backoff | 🟠 High | Easy | Low | None |
| U-08 | Web UI | Canvas VU meter peak-hold (2s decay, visual peak line) | 🟡 Medium | Easy | Low | None |
| U-09 | Web UI | Input/output channel reorder (drag-and-drop or up/down buttons) | 🟢 Low | Hard | Medium | None |
| T-01 | Testing | WebSocket integration tests (meter stream, reconnect) | 🟠 High | Medium | Low | None |
| T-02 | Testing | DSP correctness unit tests (matrix mix math, strip/bus gain) | 🟠 High | Easy | Low | None |
| T-03 | Testing | Scene file roundtrip tests (save → load → verify TOML) | 🟡 Medium | Easy | Low | None |
| T-04 | Testing | Fuzz testing of REST API (cargo-fuzz on routes) | 🟡 Medium | Medium | Low | BUG-01 |
| D-09 | Dante / Audio | mDNS/DNS-SD registration for Dante Controller visibility | 🔴 Critical | Medium | Medium | None |
| D-10 | Dante / Audio | DSCP/QoS markings on PTP and RTP sockets | 🟡 Medium | Easy | Low | D-01 |
| R-11 | Reliability | SCHED_FIFO RT thread priority for DSP thread | 🟠 High | Easy | Low | None |
| R-12 | Reliability | No-alloc / no-lock audit on DSP hot path | 🟠 High | Medium | Low | None |
| R-13 | Reliability | ETag optimistic locking on routing state (409 on stale write) | 🟡 Medium | Medium | Low | None |
| T-05 | Testing | Scene TOML schema_version field + migration logic | 🟡 Medium | Easy | Low | None |
| C-01 | Cockpit | cockpit-inferno patchbox panel (service status + web UI iframe embed) | 🟢 Low | Medium | Low | R-01, R-02 |

---

## Where to Start

### Top 5 Quick Wins
*(High/Critical importance + Easy difficulty — implement these first)*

| ID | Title | Why First |
|----|-------|-----------|
| BUG-01 | Scene path traversal fix | Critical security hole, 5-line fix |
| S-02 | Restrict CORS origins | One-liner, blocks CSRF attacks |
| R-01 | Systemd watchdog | One function call, prevents silent crashes |
| R-03 | PID lock file | Prevents scene corruption in ~10 lines |
| R-06 | Atomic scene writes | Prevents data loss, trivial rename-to pattern |

### Top 5 High-Impact Items
*(Combination of Importance + largest operational impact)*

| ID | Title | Impact |
|----|-------|--------|
| D-01 | Dante TX path wired | The core missing feature — audio won't route without it |
| S-01 | API authentication | Enables safe deployment in pub environment |
| U-01 | Zone/bar-scoped view | Core pub use-case — per-bar tablet shows only that bar's channels |
| R-04 | Dante auto-reconnect | Prevents audio outage surviving a network blip |
| S-05 | Role-based access | Admin/operator/bar-staff separation — needed for production |

### Recommended Sequencing (Sprints)

**Sprint 1 — Security & Reliability Baseline** (5 items, all Easy)
`BUG-01` → `BUG-02` → `S-02` → `R-01` → `R-03`

**Sprint 2 — Security Hardening** (5 items)
`S-01` → `S-03` → `S-06` → `S-07` → `S-08`

**Sprint 3 — Reliability & Ops** (6 items)
`R-02` → `R-04` → `R-05` → `R-06` → `R-07` → `R-10`

**Sprint 4 — Build & Observability** (6 items)
`BUG-03` → `BUG-04` → `R-08` → `R-09` → `O-01` → `O-03`

**Sprint 5 — Dante Audio Path** (3 items, multi-day)
`D-01` → `D-02` → `D-03`

**Sprint 6 — UI & UX Polish** (5 items)
`U-07` → `U-04` → `U-08` → `U-02` → `U-03`

**Sprint 7 — Zone/Auth/Pub Features** (3 items)
`S-05` → `U-01` → `T-01`

**Sprint 8 — DSP & Advanced** (as time permits)
`D-05` → `D-06` → `U-05` → `T-02` → `T-04`

---

## Dependency Map

```
BUG-01  → (none)           [foundation: unblocks T-04]
BUG-02  → (none)
BUG-03  → (none)
BUG-04  → (none)
S-01    → (none)           [foundation: unblocks S-04, S-05]
S-02    → (none)
S-03    → (none)
S-04    → S-01
S-05    → S-01             [foundation: unblocks U-01]
S-06    → (none)
S-07    → (none)
S-08    → (none)
R-01    → (none)           [foundation: unblocks D-02, C-01]
R-02    → (none)           [foundation: unblocks C-01]
R-03    → (none)
R-04    → (none)
R-05    → (none)
R-06    → (none)
R-07    → (none)
R-08    → (none)
R-09    → (none)
R-10    → (none)
O-01    → (none)
O-02    → (none)
O-03    → (none)
O-04    → (none)
O-05    → (none)
O-06    → (none)
O-07    → (none)
O-08    → (none)
D-01    → (none)           [foundation: unblocks D-03, D-04, D-08]
D-02    → R-01
D-03    → D-01
D-04    → D-01
D-05    → (none)           [unblocks D-07]
D-06    → (none)
D-07    → D-05
D-08    → D-01
U-01    → S-05
U-02    → (none)
U-03    → (none)
U-04    → (none)
U-05    → (none)
U-06    → (none)
U-07    → (none)
U-08    → (none)
U-09    → (none)
T-01    → (none)
T-02    → (none)
T-03    → (none)
T-04    → BUG-01
C-01    → R-01, R-02

Foundation items (no deps, unblock others): BUG-01, S-01, R-01, R-02, D-01
```

---

## Bug Fixes

### BUG-01 — Scene path traversal: sanitise file names

**Importance:** 🔴 Critical  
**Impact:** Prevents read/write/delete of arbitrary files outside the scenes directory  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`scene_path()` in `patchbox-core/src/scene.rs` constructs a file path by concatenating the scenes directory with a user-supplied name: `dir.join(format!("{}.toml", name))`. No sanitisation is applied. A name like `../../etc/passwd` escapes the scenes directory.

##### Why implement?
Any client (no auth required currently) can call `POST /api/v1/scenes` with `{"name":"../../etc/cron.d/evil"}` to write arbitrary TOML content outside the scenes directory, or `DELETE /api/v1/scenes/../../important_file` to delete any file the process has write permission to. This is a classic path traversal (CWE-22).

##### Why NOT implement (or defer)?
No reason to defer. It is trivially exploitable and trivially fixed.

##### Implementation notes
```rust
// In scene.rs — add before scene_path() is called:
fn sanitise_name(name: &str) -> Result<&str, SceneError> {
    // Reject empty, dots-only, path separators, null bytes
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name == ".."
        || name == "."
    {
        return Err(SceneError::InvalidName(name.to_owned()));
    }
    Ok(name)
}
// Add InvalidName variant to SceneError, return 400 Bad Request from handlers
```
Also add a max length: `if name.len() > 128 { return Err(...) }`.

---

### BUG-02 — WebSocket message size unbounded — DOS vector

**Importance:** 🔴 Critical  
**Impact:** Prevents memory exhaustion from oversized WebSocket frames  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
The WebSocket handler in `ws.rs` calls `socket.recv()` with no message size limit. An attacker can send a multi-gigabyte binary frame, exhausting server memory. axum's `WebSocket` supports `max_message_size` configuration.

##### Why implement?
The server currently has no bound on incoming WS message size. In the bar/pub environment any tablet or device on the network can connect to `/ws` and send arbitrarily large messages, potentially crashing the service.

##### Why NOT implement (or defer)?
No reason to defer. The fix is a single line on the `WebSocketUpgrade`.

##### Implementation notes
```rust
// In ws.rs — on the WebSocketUpgrade extractor:
ws.max_message_size(64 * 1024)  // 64 KiB max — well above any control message
  .on_upgrade(|socket| handle_ws(socket, state))
```
For context: the largest expected inbound message is a future control JSON (`{"op":"set_gain",...}`) which is <200 bytes.

---

### BUG-03 — Matrix cell gain not clamped at the API layer

**Importance:** 🟠 High  
**Impact:** Consistent validation across all gain-setting endpoints; prevents NaN/Inf propagation into DSP  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`PATCH /api/v1/matrix/:in/:out` passes `body.gain` directly to `params.matrix.set()` without clamping at the handler level. The `set()` function does clamp internally, but this is inconsistent — `set_input_gain_trim` and `set_output_master_gain` both clamp explicitly at the API layer. Additionally, if `gain` is `NaN` or `Infinity` (valid IEEE 754, parseable as JSON), `clamp(0.0, 4.0)` returns `NaN` unchanged.

##### Why implement?
Downstream DSP will produce NaN audio samples if gains are NaN, causing silence or noise on all outputs. Consistency also makes the API contract clearer.

##### Why NOT implement (or defer)?
Low urgency if the only clients are the trusted web UI. Becomes critical once external clients exist.

##### Implementation notes
```rust
// In patch_matrix_cell handler:
let gain = body.gain;
if !gain.is_finite() {
    return StatusCode::UNPROCESSABLE_ENTITY.into_response();
}
params.matrix.set(input, output, gain.clamp(0.0, 4.0));
```
Apply the same `is_finite()` guard to all gain-accepting handlers.

---

### BUG-04 — Channel name / scene name has no length limit

**Importance:** 🟠 High  
**Impact:** Prevents memory exhaustion and oversized TOML files via API  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`NameBody { name: String }` and `SaveSceneBody { name: String }` accept arbitrary-length strings. A client can POST a 100 MB string as a channel name, which gets stored in `AppState` (in-memory) and potentially written to a TOML file.

##### Why implement?
An attacker can exhaust memory by renaming many channels with multi-MB strings, or fill disk with large scene files. The fix is one line per handler.

##### Why NOT implement (or defer)?
No reason to defer.

##### Implementation notes
```rust
const MAX_LABEL_LEN: usize = 64;
const MAX_SCENE_NAME_LEN: usize = 128;

// In set_input_name / set_output_name:
if body.name.len() > MAX_LABEL_LEN {
    return StatusCode::UNPROCESSABLE_ENTITY.into_response();
}

// In save_scene (and validated by BUG-01 fix for scene names):
if body.name.len() > MAX_SCENE_NAME_LEN {
    return StatusCode::UNPROCESSABLE_ENTITY.into_response();
}
```

---

## Security

### S-01 — API key authentication (bearer token middleware)

**Importance:** 🔴 Critical  
**Impact:** Only authorised tablets/clients can control audio routing; prevents casual interference in pub  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Add a Tower middleware layer that validates a `Bearer` token on all REST endpoints and a query-param token on the WebSocket upgrade. Tokens are stored in config or a `.keys` file. Initially a single shared secret per bar; later per-role tokens (see S-05).

##### Why implement?
The pub has bar staff, customers on the same WiFi, and possibly other devices. Any device on the LAN can currently modify audio routing. A simple bearer token stops accidental and malicious interference without requiring full OAuth.

##### Why NOT implement (or defer)?
If the service is isolated to a dedicated VLAN with no customer access, a shared secret is overkill. Defer to after the Dante audio path is working (D-01) if auth complexity would slow down that work.

##### Implementation notes
```rust
// Cargo.toml: add tower = { version = "0.5", features = ["util"] }
// Create crates/patchbox/src/api/auth.rs:
use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};

pub async fn require_api_key(
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let key = req.headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if key == Some(expected_key) {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}
// Apply with: Router::new().route_layer(axum::middleware::from_fn(require_api_key))
```
Read key from `PATCHBOX_API_KEY` env var (also in config). Web UI reads key from `localStorage` and sets `Authorization` header on all `fetch()` calls and WS URL param.

---

### S-02 — Restrict CORS to known origins

**Importance:** 🔴 Critical  
**Impact:** Blocks cross-origin attacks from malicious web pages on the same network  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`CorsLayer::permissive()` allows all origins, methods, and headers. Replace with an allowlist of the service's own origin(s).

##### Why implement?
With permissive CORS, any webpage opened on a device that also has the patchbox web UI open can make JavaScript `fetch()` calls to the API (CSRF). A malicious WiFi captive portal could mute all outputs.

##### Why NOT implement (or defer)?
If the service will always be accessed via IP (not hostname), the allowed origin must include both the IP and any hostname aliases. List them in config.

##### Implementation notes
```rust
// In api/mod.rs — replace permissive() with:
use tower_http::cors::{AllowOrigin, CorsLayer};

let origins: Vec<_> = cfg.allowed_origins
    .iter()
    .map(|o| o.parse().unwrap())
    .collect();

let cors = CorsLayer::new()
    .allow_origin(AllowOrigin::list(origins))
    .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
    .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);
```
Add `allowed_origins: Vec<String>` to `Config`, default `["http://localhost:8080"]`. Document that users must add `http://<device-ip>:8080` to their config.

---

### S-03 — Rate limiting on REST + WebSocket endpoints

**Importance:** 🔴 Critical  
**Impact:** Prevents DOS by request flooding; limits brute-force against API key  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add per-IP rate limiting using `tower_governor` or `tower-http`'s built-in rate limiter. Target: 100 req/s per IP on REST, 5 WS connections per IP.

##### Why implement?
Without rate limiting, any device on the pub WiFi can flood the service with requests. At 8080/s request rate on a hot endpoint like `/state`, the tokio runtime will stall processing legitimate control commands.

##### Why NOT implement (or defer)?
If the service is behind a reverse proxy (nginx, traefik), rate limiting there is sufficient. Document the assumption. Defer if hardware-specific.

##### Implementation notes
```toml
# Cargo.toml
tower_governor = "0.4"
```
```rust
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};

let governor_conf = GovernorConfigBuilder::default()
    .per_second(100)
    .burst_size(200)
    .finish()
    .unwrap();

let router = Router::new()
    // ...
    .layer(GovernorLayer { config: Arc::new(governor_conf) });
```

---

### S-04 — TLS termination

**Importance:** 🔴 Critical  
**Impact:** Credentials and audio control commands cannot be intercepted on pub WiFi  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** S-01

##### What is it?
Enable HTTPS for the REST API and WSS for WebSocket. Either via `axum-server` with `rustls`, or by documenting a reverse-proxy setup (nginx/caddy with a self-signed cert or LetsEncrypt).

##### Why implement?
API keys sent over HTTP on a pub WiFi are trivially sniffable. Once auth (S-01) is in place, the key itself becomes a secret that needs transport security.

##### Why NOT implement (or defer)?
On a dedicated wired LAN VLAN with no external exposure, TLS adds operational complexity (cert management). A reasonable defer condition: dedicated LAN + no WiFi access to the control network.

##### Implementation notes
**Option A — reverse proxy (recommended for simplicity):**
```nginx
# /etc/nginx/sites-available/patchbox
server {
    listen 443 ssl;
    ssl_certificate     /etc/ssl/patchbox.crt;
    ssl_certificate_key /etc/ssl/patchbox.key;
    location / { proxy_pass http://127.0.0.1:8080; proxy_http_version 1.1;
                 proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
}
```
**Option B — axum-server + rustls:**
```toml
axum-server = { version = "0.6", features = ["tls-rustls"] }
```
```rust
axum_server::bind_rustls(addr, tls_config).serve(router.into_make_service()).await?
```

---

### S-05 — Role-based access control

**Importance:** 🟠 High  
**Impact:** Bar staff can only control their zone; operators control all zones; admin can configure  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** S-01

##### What is it?
Define 4 roles: `admin` (full config), `operator` (all zones, matrix), `bar-staff` (own zone read-write), `readonly` (observe only). Enforce role on each route. Store role with API key.

##### Why implement?
The pub use-case explicitly requires that bar staff at bar 3 cannot accidentally mute bar 7. Zone separation is only enforceable with role-scoped tokens.

##### Why NOT implement (or defer)?
Defer until zone scoping (U-01) is designed — RBAC is meaningless without zones defined. Implement in Sprint 7 after zone model is designed.

##### Implementation notes
```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Role { Admin, Operator, BarStaff { zone: usize }, Readonly }

// Config: api_keys = [{ key = "abc123", role = "operator" }, ...]
// Middleware extracts Role from validated key, inserts into request extensions
// Handler checks: require_role!(Role::Operator, &role)?
```

---

### S-06 — WebSocket origin validation

**Importance:** 🟠 High  
**Impact:** Prevents cross-origin WebSocket hijacking from malicious pages  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Check the `Origin` header on WebSocket upgrade requests. Reject if not in the allowed-origins list.

##### Why implement?
Browsers send the `Origin` header on WebSocket upgrades. Without validation, a malicious page on any origin can subscribe to the real-time meter stream and observe when audio is active (privacy concern) or inject control messages (once WS control is implemented).

##### Why NOT implement (or defer)?
Only blocks browser-based attacks; `curl`/`wscat` can omit Origin. Still worth doing as defence-in-depth.

##### Implementation notes
```rust
// In ws handler, before on_upgrade:
if let Some(origin) = headers.get("origin") {
    let origin_str = origin.to_str().unwrap_or("");
    if !cfg.allowed_origins.iter().any(|o| o == origin_str) {
        return StatusCode::FORBIDDEN.into_response();
    }
}
```

---

### S-07 — Scrub error messages from 500 responses

**Importance:** 🟠 High  
**Impact:** File paths, OS errors, and parse failures no longer leaked to unauthenticated clients  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Scene save/load/delete handlers return `e.to_string()` in 500 responses, leaking internal paths like `/var/lib/patchbox/scenes/foo.toml: Permission denied (os error 13)`.

##### Why implement?
Error strings can reveal file system layout, user names, and operational state to unauthenticated clients. Replace with opaque error codes logged server-side.

##### Implementation notes
```rust
// Replace: (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
// With:
tracing::error!("scene operation failed: {}", e);
StatusCode::INTERNAL_SERVER_ERROR.into_response()
// Or with a structured error body:
Json(json!({"error": "internal_error", "code": 500})).into_response()
```

---

### S-08 — WebSocket client connection limit

**Importance:** 🟠 High  
**Impact:** Prevents memory exhaustion from hundreds of simultaneous WS connections  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a global `AtomicUsize` counter for active WebSocket connections. Reject upgrades when count exceeds `MAX_WS_CLIENTS` (default 32).

##### Why implement?
Each WS client spawns a task and holds an `Arc` clone of the state. In the pub scenario, there are at most ~10 tablets. If a misconfigured client reconnects in a loop, connections accumulate. At 1000+ connections the tokio thread pool stalls on meter broadcasts.

##### Implementation notes
```rust
// In AppState:
pub ws_clients: AtomicUsize,  // no RwLock needed

// In ws handler:
const MAX_WS_CLIENTS: usize = 32;
let prev = state.ws_clients.fetch_add(1, Ordering::Relaxed);
if prev >= MAX_WS_CLIENTS {
    state.ws_clients.fetch_sub(1, Ordering::Relaxed);
    return StatusCode::SERVICE_UNAVAILABLE.into_response();
}
// In handle_ws cleanup: state.ws_clients.fetch_sub(1, Ordering::Relaxed);
```

---

## Reliability

### R-01 — Systemd watchdog (WatchdogSec + sd_notify heartbeat)

**Importance:** 🔴 Critical  
**Impact:** systemd kills and restarts a deadlocked or crashed service within 10s, not never  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add `WatchdogSec=10s` to the systemd unit and call `sd_notify(WATCHDOG=1)` from a tokio task every 5s. Without this, a deadlocked process appears running to systemd even though audio has stopped.

##### Why implement?
In a pub, a deadlocked patchbox process means all audio routing is silent/frozen until someone manually restarts the service. With a watchdog, recovery is automatic within 10s.

##### Why NOT implement (or defer)?
No reason to defer. It is a net safety improvement with zero downside.

##### Implementation notes
```toml
# Cargo.toml: systemd = "0.10"  (libsystemd bindings)
```
```rust
// In main.rs — after server starts:
tokio::spawn(async {
    loop {
        systemd::daemon::notify(false, [("WATCHDOG", "1")].iter()).ok();
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
});
systemd::daemon::notify(false, [("READY", "1")].iter()).ok();
```
```ini
# In systemd/dante-patchbox.service:
WatchdogSec=10s
NotifyAccess=main
Type=notify  # change from simple
```

---

### R-02 — Deep health check

**Importance:** 🔴 Critical  
**Impact:** Monitoring knows when Dante is dead or scenes dir is unwritable, not just HTTP is up  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Extend `/api/v1/health` to check: (1) Dante device task alive (channel signal), (2) scenes directory writable, (3) meter data freshness (last update within 5s).

##### Why implement?
Docker healthcheck and external monitoring both call `/api/v1/health`. Currently it always returns `"ok"` even if Dante is dead and all audio is silenced. The bar manager has no way to know from the outside that audio routing is broken.

##### Implementation notes
```rust
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    inputs: usize,
    outputs: usize,
    dante_ok: bool,          // true if Dante task has reported alive within 30s
    scenes_dir_ok: bool,     // true if dir is writable
    meter_fresh: bool,       // true if meters updated within 5s
}
// Add AppState.dante_last_beat: Arc<AtomicU64> (Unix timestamp)
// Dante task updates this every N frames
// Health handler checks: now - dante_last_beat < 30s
```

---

### R-03 — PID lock file — prevent duplicate instances

**Importance:** 🔴 Critical  
**Impact:** Prevents two instances corrupting shared scene files simultaneously  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Write a PID file to `/var/run/patchbox.pid` (or `$RUNTIME_DIRECTORY/patchbox.pid`) at startup. Check if file exists and PID is alive before starting. Remove on clean shutdown.

##### Why implement?
Two running instances share the same `scenes_dir`. Concurrent writes to scene TOML files are not serialised across processes. This is most likely to happen after a failed systemd restart that leaves an orphan process.

##### Implementation notes
```rust
use std::fs;
use std::process;

fn acquire_pid_lock(path: &Path) -> anyhow::Result<()> {
    if let Ok(contents) = fs::read_to_string(path) {
        if let Ok(pid) = contents.trim().parse::<u32>() {
            // Check if that PID is still alive
            if Path::new(&format!("/proc/{}", pid)).exists() {
                anyhow::bail!("Another instance is running (PID {})", pid);
            }
        }
    }
    fs::write(path, process::id().to_string())?;
    Ok(())
}
// Register atexit or on SIGTERM to remove the file.
```

---

### R-04 — Dante device auto-reconnect on failure

**Importance:** 🟠 High  
**Impact:** Audio routing recovers automatically after a Dante network blip without operator intervention  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
If the Dante device task (`DanteDevice::start_with_params()`) returns an error, spawn a retry task that waits 30s and restarts it. Cap at 10 retries with exponential backoff.

##### Why implement?
Currently a Dante device failure is logged and silently ignored — the HTTP server keeps running but all audio is dead. In a pub, this means silence until someone SSH-es in and restarts the service.

##### Implementation notes
```rust
// In main.rs — replace single spawn with retry loop:
tokio::spawn(async move {
    let mut backoff = Duration::from_secs(5);
    loop {
        let result = dante.start_with_params(
            Arc::clone(&params_arc), Arc::clone(&meters_arc)
        ).await;
        tracing::error!("Dante device exited: {:?}, retrying in {:?}", result, backoff);
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(120));
    }
});
```

---

### R-05 — Config validation at startup with hard-fail option

**Importance:** 🟠 High  
**Impact:** Invalid config fails fast with clear error, not silently as default 8×8 matrix  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a `Config::validate()` method that checks: `n_inputs` and `n_outputs` in range 1–64, `port` > 1024 (or requires CAP_NET_BIND_SERVICE), `scenes_dir` non-empty. Add `--strict-config` flag to exit on any config issue.

##### Why implement?
Currently a malformed config silently produces all-default settings. On a production system, this means the operator deploys with the wrong channel count and doesn't notice until Dante subscriptions fail to route.

##### Implementation notes
```rust
impl Config {
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.n_inputs == 0 || self.n_inputs > 64 {
            errors.push(format!("n_inputs {} out of range 1–64", self.n_inputs));
        }
        if self.n_outputs == 0 || self.n_outputs > 64 {
            errors.push(format!("n_outputs {} out of range 1–64", self.n_outputs));
        }
        errors
    }
}
// In main.rs:
let errors = cfg.validate();
if !errors.is_empty() {
    for e in &errors { tracing::error!("Config error: {}", e); }
    if args.strict_config { anyhow::bail!("Invalid config"); }
}
```

---

### R-06 — Atomic scene file writes

**Importance:** 🟠 High  
**Impact:** Scene save never produces a corrupt/empty TOML file even if the process is killed mid-write  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Replace `fs::write(path, contents)` with write-to-temp-file + `fs::rename()`. On Linux, `rename()` is atomic at the filesystem level — readers always see a complete file.

##### Why implement?
`fs::write()` truncates first, then writes. If the process dies between truncate and write (power loss, SIGKILL), the scene file is empty or partial. This is data loss for a saved mixer preset.

##### Implementation notes
```rust
// In scene.rs::save():
let tmp_path = path.with_extension("toml.tmp");
fs::write(&tmp_path, &contents)?;
fs::rename(&tmp_path, &path)?;  // atomic on same filesystem
```
Ensure `tmp_path` is on the same filesystem as `path` (same directory = guaranteed).

---

### R-07 — WebSocket backpressure — drop slow clients

**Importance:** 🟠 High  
**Impact:** Slow tablet clients cannot cause memory growth or block meter broadcasts to fast clients  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
When the WebSocket sender queue fills (client is slow to drain), drop the frame rather than queuing indefinitely. Use `try_send()` on a bounded channel instead of `send().await`.

##### Why implement?
The current WS loop calls `socket.send(meter_frame).await` which blocks if the client's TCP window is full. This blocks the entire broadcast task for all clients until the slow client catches up.

##### Implementation notes
```rust
// Replace:
if socket.send(Message::Binary(frame)).await.is_err() { break; }
// With a bounded channel per client (e.g. 4-frame buffer):
// Spawn per-client sender task with tokio::sync::mpsc::channel(4)
// If send returns Err (full), log and continue — frame dropped, not queued
```

---

### R-08 — Structured JSON logging

**Importance:** 🟡 Medium  
**Impact:** Logs are parseable by journald, Loki, ELK — enables alerting on error patterns  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a `--log-json` flag (and `PATCHBOX_LOG_JSON=1` env var) that switches `tracing-subscriber` to JSON format output. Default remains human-readable.

##### Why implement?
The pub's central server may aggregate logs from multiple services. JSON logs are ingestible by Loki/Grafana (which may already be running for other services). Error alerting ("Dante device failed") becomes automatable.

##### Implementation notes
```toml
# Cargo.toml: tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
```
```rust
if args.log_json {
    tracing_subscriber::fmt().json().with_env_filter(filter).init();
} else {
    tracing_subscriber::fmt().with_env_filter(filter).init();
}
```

---

### R-09 — Prometheus metrics endpoint

**Importance:** 🟡 Medium  
**Impact:** Real-time visibility into request latency, connection count, and audio path health  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Expose `GET /metrics` in Prometheus text format. Key metrics: HTTP request count/latency by route, active WS connections, Dante RX/TX frame count, last meter update age.

##### Why implement?
Operators currently have no way to know if the mixer is processing audio frames or silently stuck. A Prometheus scrape + Grafana dashboard enables alerting: "no Dante frames in 30s = alert".

##### Implementation notes
```toml
# Cargo.toml:
metrics = "0.23"
metrics-exporter-prometheus = "0.15"
```
```rust
// In main.rs:
let prometheus_handle = metrics_exporter_prometheus::PrometheusBuilder::new()
    .install_recorder()?;
// Add route: .route("/metrics", get(|| async move { prometheus_handle.render() }))
// In bridge.rs RX callback:
metrics::counter!("patchbox_dante_rx_frames_total").increment(1);
```

---

### R-10 — Graceful Dante device shutdown on SIGTERM

**Importance:** 🟡 Medium  
**Impact:** Dante device announces departure on network on clean shutdown, reducing Dante Controller stale entries  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Signal the Dante device task to stop via a `CancellationToken` when SIGTERM is received, before the tokio runtime drops. This allows `inferno_aoip` to send a Dante device farewell message.

##### Why implement?
Abruptly dropped Dante devices linger in Dante Controller for 30–60s as "unresponsive". Graceful exit cleans up immediately, important for rapid redeploy cycles during development.

##### Implementation notes
```rust
// In main.rs:
use tokio_util::sync::CancellationToken;
let cancel = CancellationToken::new();
let cancel_dante = cancel.clone();
tokio::spawn(async move {
    dante.start_with_params_cancellable(params_arc, meters_arc, cancel_dante).await
});
// In shutdown_signal():
cancel.cancel();
```

---

## Ops & Build

### O-01 — aarch64 cross-compile CI matrix

**Importance:** 🟠 High  
**Impact:** Guaranteed working arm64 binary for EliteDesk ARM nodes and Raspberry Pi 4 without manual testing  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a `cross` build job to CI that produces an `aarch64-unknown-linux-gnu` release binary using `cross-rs/cross`. Upload both architectures as CI artifacts and GitHub Release assets.

##### Why implement?
The target hardware (EliteDesk, RPi 4) may be arm64. Without automated cross-compilation, an aarch64 deployment requires a manual build on an ARM machine. The Dockerfile comment already mentions this gap.

##### Implementation notes
```yaml
# In .github/workflows/ci.yml — add to build job matrix:
strategy:
  matrix:
    include:
      - target: x86_64-unknown-linux-gnu
        os: ubuntu-latest
      - target: aarch64-unknown-linux-gnu
        os: ubuntu-latest
        use_cross: true

steps:
  - uses: taiki-e/install-action@v2
    with: { tool: cross }
    if: matrix.use_cross
  - run: cross build --release --target ${{ matrix.target }} -p patchbox
    if: matrix.use_cross
  - run: cargo build --release -p patchbox
    if: "!matrix.use_cross"
```

---

### O-02 — GitHub Releases automation

**Importance:** 🟡 Medium  
**Impact:** `git tag v0.2.0 && git push --tags` produces a GitHub Release with binaries attached  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a GitHub Actions workflow that triggers on version tags (`v*`) and creates a GitHub Release with the x86_64 and aarch64 binaries attached.

##### Implementation notes
```yaml
# .github/workflows/release.yml
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --release -p patchbox
      - uses: softprops/action-gh-release@v2
        with:
          files: target/release/patchbox
```

---

### O-03 — Binary stripping + LTO in release profile

**Importance:** 🟡 Medium  
**Impact:** Binary size drops from 6.2 MiB to ~2.5 MiB; slightly faster startup  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add `[profile.release]` settings to workspace `Cargo.toml` to enable symbol stripping, LTO, and single codegen unit.

##### Why implement?
Embedded/single-board deployments benefit from smaller binaries. Smaller binary = faster `scp` deploy, less flash wear.

##### Why NOT implement?
LTO significantly increases build time (3–5×). On dev machines with incremental builds this hurts iteration speed. Use `cargo build --profile release` for distribution only.

##### Implementation notes
```toml
# In workspace Cargo.toml:
[profile.release]
strip = true
lto = true
codegen-units = 1
opt-level = 3
```
Consider a separate `dist` profile to avoid slowing dev `--release` builds.

---

### O-04 — MSRV declaration + CI pin

**Importance:** 🟡 Medium  
**Impact:** Users know minimum Rust version; CI catches regressions if a crate raises MSRV  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Declare `rust-version = "1.77"` in workspace `Cargo.toml` and add a CI job that builds with `dtolnay/rust-toolchain@1.77`.

##### Implementation notes
```toml
# In [workspace.package]:
rust-version = "1.77"
```
```yaml
# In CI check job, add:
- uses: dtolnay/rust-toolchain@1.77
  name: MSRV check
- run: cargo check --workspace
```

---

### O-05 — OCI image labels

**Importance:** 🟢 Low  
**Impact:** Docker images self-document version, source, and license  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### Implementation notes
```dockerfile
LABEL org.opencontainers.image.title="dante-patchbox" \
      org.opencontainers.image.description="Dante AoIP matrix mixer DSP patchbay" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.source="https://github.com/legopc/dante-patchbox" \
      org.opencontainers.image.licenses="MIT"
```
Use a build arg to inject the version from `git describe --tags`.

---

### O-06 — Changelog + semantic versioning

**Importance:** 🟡 Medium  
**Impact:** Users and operators know what changed in each version without reading git log  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### Implementation notes
Create `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com) format. Add a `cliff.toml` for `git-cliff` to auto-generate entries from conventional commits. Bump `Cargo.toml` version before each release.

---

### O-07 — Pin inferno_aoip git dependency to commit hash

**Importance:** 🟠 High  
**Impact:** Reproducible builds; upstream changes to teodly/inferno cannot silently break audio  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
The `inferno_aoip` dependency uses `git = "..."` with no `rev` specified. Any push to `teodly/inferno` main can silently change the build when `cargo update` is run.

##### Implementation notes
```toml
# In patchbox-dante/Cargo.toml:
inferno_aoip = { git = "https://github.com/teodly/inferno", rev = "abc1234", optional = true }
```
Record the current commit hash from `Cargo.lock` and pin it. Update intentionally when pulling upstream changes.

---

### O-08 — README: prerequisites, install, troubleshooting, TUI docs

**Importance:** 🟡 Medium  
**Impact:** New operators can deploy without needing to read the source code  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is missing
- Prerequisites (PTP clock, Dante network, CAP_NET_RAW, Linux 5.10+)
- systemd install steps (`systemctl enable/start`, config file location)
- Docker compose usage
- TUI usage (`--tui` flag)
- Troubleshooting: "device not in Dante Controller" → check statime, check features flag
- Performance/latency expectations
- Known limitations (stub mode without `--features inferno`)

---

## Dante / Audio

### D-01 — Wire Dante TX transmit ring buffers

**Importance:** 🔴 Critical  
**Impact:** Processed audio actually reaches Dante TX outputs — the core product feature  
**Difficulty:** Hard  
**Risk:** High  
**Prerequisites:** None

##### What is it?
The TODO comment at `device.rs:158` marks the transmit path as unimplemented. The `transmit_from_external_buffer` inferno_aoip API call needs to be wired to the output of `AudioBridge::process()` so DSP-processed audio flows to Dante TX channels.

##### Why implement?
Without TX, the patchbox routes nothing. It is the single most important remaining feature.

##### Why NOT implement (or defer)?
Requires a running Dante/PTP network environment to test. Cannot be unit-tested without `--features inferno` + statime.

##### Implementation notes
In `bridge.rs::process()`, after the mix loop:
```rust
// For each output channel o:
let out_buf: Vec<i32> = output_buffers[o].iter()
    .map(|&s| sample_conv::f32_to_i32(s))
    .collect();
device.transmit_from_external_buffer(o, &out_buf)?;
```
The exact API depends on the inferno_aoip `DeviceServer` TX callback signature — read `teodly/inferno/inferno_aoip/src/` for the latest API before implementing.

---

### D-02 — statime PTP daemon health check integration

**Importance:** 🔴 Critical  
**Impact:** Health check and logs report PTP sync status — essential for Dante timing  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** R-01

##### What is it?
Query `statime` (or `ptp4l`) for PTP lock status at startup and expose it in the health endpoint. If PTP is not locked, Dante device cannot start correctly.

##### Why implement?
Dante audio is sample-accurate and requires PTP synchronisation. If `statime` is not running or not locked, `DeviceServer::start()` will block indefinitely. A health check that reports PTP status lets operators diagnose "why is there no audio" without SSH access.

##### Implementation notes
```bash
# statime exposes a D-Bus interface or a status file
# Check via: systemctl is-active statime.service
```
```rust
// In health handler:
let ptp_ok = std::process::Command::new("systemctl")
    .args(["is-active", "--quiet", "statime.service"])
    .status()
    .map(|s| s.success())
    .unwrap_or(false);
```

---

### D-03 — Dante device name and channel names announced on network

**Importance:** 🟠 High  
**Impact:** Device appears in Dante Controller with correct name and channel labels instead of defaults  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** D-01

##### What is it?
Configure `inferno_aoip` with the device name from `Config.device_name` and the input/output channel labels from `AudioParams.inputs[i].label` / `.outputs[o].label` at startup and when labels change.

##### Why implement?
Currently the Dante device (when `--features inferno`) would announce with the default inferno device name and numeric channel labels. The pub's Dante Controller shows 7 devices — correct names ("Bar 1 In", "Bar 3 Out") are essential for operator usability.

---

### D-04 — Dante Controller subscription status in web UI

**Importance:** 🟡 Medium  
**Impact:** UI shows which Dante channels are actively subscribed vs idle  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** D-01

##### What is it?
Query `inferno_aoip` for current subscription state (which RX channels have active flows). Display a subscription indicator (green dot / grey dot) next to each input channel in the matrix.

##### Why implement?
An input channel with no Dante subscription has no audio, even if the matrix gain is non-zero. The UI should make this obvious to bar staff: "Bar 3 mic is not connected in Dante Controller."

---

### D-05 — Parametric EQ per input strip

**Importance:** 🟡 Medium  
**Impact:** Bar operators can tune room EQ per zone without external hardware  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Add a 4-band parametric EQ to each `StripParams` using `fundsp`'s `biquad_bank`. Expose EQ parameters (freq, gain, Q) via REST and the web UI. DSP runs in-line in the existing `apply_strip()` function.

##### Implementation notes
```rust
// In strip.rs:
pub struct StripParams {
    // existing fields...
    pub eq: [BiquadParams; 4],  // 4-band PEQ
}
// fundsp: let eq_node = biquad_bank(...);
// Process: eq_node.filter_mono(sample)
```
UI: Click on strip → EQ panel opens with 4 bands on a frequency/gain graph.

---

### D-06 — Compressor/limiter per output bus

**Importance:** 🟡 Medium  
**Impact:** Prevents clipping and level inconsistency between zones/bars  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Add a feed-forward compressor with configurable threshold, ratio, attack, release to each `BusParams`. Runs after the matrix mix in `apply_bus()`. Expose parameters via REST and web UI.

---

### D-07 — EBU R128 loudness normalisation

**Importance:** 🟢 Low  
**Impact:** Consistent perceived loudness across different music sources in each zone  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** D-05

##### What is it?
Implement a momentary/short-term LUFS meter (EBU R128) per output bus. Display in the VU meter panel. Add an optional "auto-gain" mode that adjusts master gain to target -23 LUFS.

---

### D-08 — Sample-accurate latency measurement

**Importance:** 🟡 Medium  
**Impact:** Operators know and can document latency from Dante RX to Dante TX  
**Difficulty:** Hard  
**Risk:** High  
**Prerequisites:** D-01

##### What is it?
Insert a known signal on an RX channel and measure the round-trip delay to the corresponding TX channel. Report in samples and milliseconds in the health endpoint.

---

## Web UI

### U-01 — Zone/bar-scoped view

**Importance:** 🔴 Critical  
**Impact:** Bar 3 tablet shows only Bar 3's inputs/outputs — no accidental cross-zone routing  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** S-05

##### What is it?
When authenticated with a `bar-staff` role token, the web UI filters the matrix to show only the input and output channels assigned to that zone. Admin/operator sees all channels.

##### Why implement?
A 7-bar pub has up to 56 input channels (8 per bar). A bar-staff member on a tablet does not need to see or control other bars' channels. Visual clutter causes mis-routes.

##### Implementation notes
Add `zone_inputs` and `zone_outputs` arrays to the JWT/token claims or to a `/api/v1/whoami` endpoint. Web UI reads these on connect and hides rows/columns outside the zone. The server still validates that mutations are within the authorised zone.

---

### U-02 — Keyboard shortcuts

**Importance:** 🟡 Medium  
**Impact:** Power users can mute/solo/navigate the matrix without mouse  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add keyboard shortcuts: `M` = toggle mute on selected channel, `S` = toggle solo, arrow keys = navigate matrix cells, `Enter` = toggle cell gain (0/1), `+`/`-` = fine-tune gain by 0.1.

##### Implementation notes
```js
// In app.js:
document.addEventListener('keydown', e => {
  if (e.key === 'm' && selectedChannel) toggleInputMute(selectedChannel);
  if (e.key === 's' && selectedChannel) toggleInputSolo(selectedChannel);
  // etc.
});
```
Add a visual "selected cell" highlight in CSS.

---

### U-03 — Matrix cell gain tooltip: show dB value in real time

**Importance:** 🟡 Medium  
**Impact:** Operator sees exact dB value while dragging the gain slider  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
The existing gain tooltip slider (`showGainTooltip`) displays a `gainLabel()` value but updates are not instant during drag on some browsers. Ensure `input` event fires reliably and the dB value is shown in a fixed-position label near the thumb.

---

### U-04 — Mobile/tablet responsive layout

**Importance:** 🟠 High  
**Impact:** 8×8 matrix is usable on a 10" tablet (1280×800) without horizontal scrolling  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
At viewport widths below 1024px, collapse the matrix to show one input strip at a time with swipe navigation (or a simplified "which output is this input routed to" view). VU meters move below the matrix.

##### Why implement?
Bar control points are tablets (~10"). The current full matrix view requires horizontal scrolling on small screens, making it unusable in a pub environment.

##### Implementation notes
```css
@media (max-width: 1024px) {
  .matrix-grid { overflow-x: auto; }
  .input-strip { min-width: 80px; }
}
@media (max-width: 768px) {
  /* Single-strip mode: show one row at a time */
  .matrix-row:not(.active-row) { display: none; }
}
```
Add a strip selector (radio buttons or swipe) in JS to set `.active-row`.

---

### U-05 — Undo/redo stack for matrix changes

**Importance:** 🟡 Medium  
**Impact:** Accidental mute/routing change can be reversed with Ctrl+Z without loading a scene  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Maintain a client-side undo stack (max depth 50) of matrix state snapshots. Ctrl+Z reverts the last action and PATCHes the API to match. Ctrl+Y re-applies.

##### Implementation notes
```js
const undoStack = [];
function pushUndo(prevState) {
  undoStack.push(JSON.parse(JSON.stringify(prevState)));
  if (undoStack.length > 50) undoStack.shift();
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'z') applySnapshot(undoStack.pop());
});
```

---

### U-06 — Scene diff view

**Importance:** 🟢 Low  
**Impact:** Operator sees what will change before loading a scene  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a "Preview" button next to scene load that shows a diff (highlighted cells) between current state and the saved scene state, without applying it.

---

### U-07 — WebSocket reconnect with exponential backoff

**Importance:** 🟠 High  
**Impact:** Tablets reconnect automatically after network blip without page refresh  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
The current WS connection does not auto-reconnect on close. Add a reconnect loop with 1s, 2s, 4s, 8s, 16s (max) backoff.

##### Why implement?
Pub WiFi is unreliable. Tablets lose connection and currently show stale data forever. Bar staff would need to manually refresh the page.

##### Implementation notes
```js
function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  let backoff = 1000;
  ws.addEventListener('close', () => {
    updateStatus('ws', false);
    setTimeout(() => { connectWS(); backoff = Math.min(backoff * 2, 16000); }, backoff);
  });
  ws.addEventListener('open', () => { backoff = 1000; updateStatus('ws', true); });
  // ... existing handlers
}
```

---

### U-08 — Canvas VU meter peak-hold

**Importance:** 🟡 Medium  
**Impact:** Operators can see transient peaks that vanish before the eye catches them  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a peak-hold line on each Canvas VU meter: a short horizontal bar at the peak level, decaying after 2s. Standard professional audio metering behaviour.

##### Implementation notes
```js
// In meter rendering loop:
const peakDb = peakHold[ch]; // updated to max(current, peakHold) each frame
// Decay: if (now - peakHoldTime[ch] > 2000) peakHold[ch] -= 0.5 * dt;
const peakY = dbToY(peakDb);
ctx.fillStyle = '#ff6b35';
ctx.fillRect(x, peakY, barWidth, 2);  // 2px peak line
```

---

### U-09 — Channel reorder (drag-and-drop)

**Importance:** 🟢 Low  
**Impact:** Operator can arrange channels in logical order for their venue without renaming  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** None

---

## Testing

### T-01 — WebSocket integration tests

**Importance:** 🟠 High  
**Impact:** Catches regressions in the meter push pipeline and WS connection lifecycle  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add `tokio_tungstenite` or `axum-test` WS tests that: (1) connect to `/ws`, (2) receive the initial state snapshot JSON, (3) verify the binary Float32Array meter frame arrives within 200ms, (4) verify disconnect is clean.

##### Implementation notes
```rust
// In tests/ws_tests.rs:
use tokio_tungstenite::connect_async;
#[tokio::test]
async fn ws_receives_snapshot() {
    let (srv, _tmp) = make_server_with_listener().await;
    let (mut ws, _) = connect_async(format!("ws://{}/ws", srv.addr())).await.unwrap();
    let msg = ws.next().await.unwrap().unwrap();
    // First message is JSON snapshot
    let json: serde_json::Value = serde_json::from_slice(&msg.into_data()).unwrap();
    assert!(json["matrix"].is_object());
}
```

---

### T-02 — DSP correctness unit tests

**Importance:** 🟠 High  
**Impact:** Catches silent regressions in audio math (gain=0 should be silence, not NaN)  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add unit tests in `patchbox-core` for `matrix::mix()`, `strip::apply_strip()`, `bus::apply_bus()`: verify silence when muted, correct gain application, no NaN propagation.

##### Implementation notes
```rust
#[test]
fn muted_strip_produces_silence() {
    let params = StripParams { mute: true, gain_trim: 1.0, ..Default::default() };
    let mut buf = vec![1.0_f32; 64];
    apply_strip(&params, &mut buf);
    assert!(buf.iter().all(|&s| s == 0.0));
}
#[test]
fn nan_gain_does_not_propagate() {
    // Gain clamped before reaching DSP — verify
    let mut matrix = MatrixParams::new(2, 2);
    matrix.set(0, 0, f32::NAN);
    assert!(matrix.gains[0][0].is_finite());
}
```

---

### T-03 — Scene file roundtrip tests

**Importance:** 🟡 Medium  
**Impact:** Proves scene TOML serialization/deserialization is stable across versions  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Save a scene with known state, read the TOML file directly, verify the structure, reload it and confirm state is identical.

---

### T-04 — Fuzz testing REST API inputs

**Importance:** 🟡 Medium  
**Impact:** Finds unexpected panics or crashes from malformed JSON or path parameters  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** BUG-01

##### What is it?
Use `cargo-fuzz` to fuzz the JSON body parser and path parameter extraction on all REST routes. Focus on scene name, gain values, channel indices.

---

## Ecosystem Integration

### C-01 — cockpit-inferno patchbox mode panel

**Importance:** 🟢 Low  
**Impact:** Patchbox service status visible in Cockpit alongside other Inferno services  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** R-01, R-02

##### What is it?
Add a patchbox mode panel to `legopc/cockpit-inferno`: service status (running/stopped), link to web UI, basic stats (inputs/outputs, Dante status). Follows the existing cockpit-inferno panel pattern.

---

### D-09 — mDNS/DNS-SD registration for Dante Controller visibility

**Importance:** 🔴 Critical  
**Impact:** Device appears automatically in Dante Controller on the LAN without manual IP entry  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Dante devices announce themselves via mDNS (`_dante._udp.local`) so Dante Controller can discover them. Without this, the service may not appear at all in DC even with the `inferno` feature enabled.

##### Why implement?
The user reports the device doesn't show up on Dante. mDNS discovery is a prerequisite. Use the `mdns-sd` crate to broadcast device name, port, and capability records at startup.

##### Why NOT implement?
If `inferno_aoip` already handles mDNS internally, this is handled. Verify by reading the inferno_aoip source before implementing.

##### Implementation notes
```toml
# Cargo.toml (feature-gated):
mdns-sd = { version = "0.11", optional = true }
```
```rust
// At startup (if inferno_aoip doesn't already register):
let mdns = mdns_sd::ServiceDaemon::new()?;
let service = mdns_sd::ServiceInfo::new(
    "_dante._udp.local.",
    &cfg.device_name,
    &hostname,
    &addr_ip,
    cfg.port,
    &[] as &[(&str, &str)],
)?;
mdns.register(service)?;
```
Check `teodly/inferno` source first — if `DeviceServer` already calls `mdns-sd`, skip this.

---

### D-10 — DSCP/QoS markings on PTP and RTP sockets

**Importance:** 🟡 Medium  
**Impact:** Dante timing and audio packets are prioritised on managed switches, preventing jitter  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** D-01

##### What is it?
Set `IP_TOS` socket options: DSCP EF (0x2E << 2 = 0xB8) for PTP clock packets, DSCP AF41 (0x22 << 2 = 0x88) for RTP audio. Most venue switches support DSCP-based QoS.

##### Implementation notes
```rust
use std::os::unix::io::AsRawFd;
use libc::{setsockopt, IPPROTO_IP, IP_TOS};

unsafe {
    let tos: libc::c_int = 0xB8;  // EF for PTP
    setsockopt(sock.as_raw_fd(), IPPROTO_IP, IP_TOS,
               &tos as *const _ as _, std::mem::size_of_val(&tos) as _);
}
```
This is best done inside inferno_aoip's socket setup — file a PR or apply via fork if inferno doesn't support it.

---

## Additional Reliability

### R-11 — SCHED_FIFO RT thread priority for DSP thread

**Importance:** 🟠 High  
**Impact:** DSP thread is never preempted by network or tokio tasks, preventing audio dropouts  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Set the audio callback thread to `SCHED_FIFO` priority 70 using the `thread-priority` crate. The systemd unit already grants `CAP_SYS_NICE`; this wires it up in code.

##### Why implement?
Without RT scheduling, tokio's work-stealing scheduler can preempt the DSP thread during a meter WebSocket broadcast, causing an audio buffer underrun. In a pub with 7 active zones, any hiccup is audible.

##### Implementation notes
```toml
thread-priority = "1"
```
```rust
// At the start of the RT audio thread/closure:
use thread_priority::*;
set_current_thread_priority(ThreadPriority::Crossplatform(70.try_into().unwrap())).ok();
set_current_thread_schedule(ThreadSchedulePolicy::Realtime(RealtimeThreadSchedulePolicy::Fifo)).ok();
```
Pair with systemd `CPUSchedulingPolicy=fifo` and `CPUSchedulingPriority=70` in the service unit.

---

### R-12 — No-alloc / no-lock audit on DSP hot path

**Importance:** 🟠 High  
**Impact:** Eliminates latency spikes from heap allocation or lock contention in the audio callback  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Audit the audio callback code path (everything called from `bridge.rs::process()`) for heap allocations (`Vec::new`, `String`, `Box`) and `Mutex`/`RwLock` lock acquisition. Replace with pre-allocated buffers and `try_read()`/SPSC ring buffers.

##### Why implement?
Heap allocation in the audio callback can trigger the global allocator, which takes a mutex internally. This can cause jitter of 1–10ms, audible as clicks at 44.1kHz/48kHz. The current `try_read()` on params is correct — verify nothing else allocates.

##### Implementation notes
Use the `no_std_compat` allocator shim or add a `#[global_allocator]` that panics in RT context during development. Alternatively use `std::hint::black_box` and measure with `perf stat -e cache-misses` during a simulated audio load.

---

### R-13 — ETag optimistic locking on routing state

**Importance:** 🟡 Medium  
**Impact:** Two tablets editing simultaneously cannot silently overwrite each other's changes  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a `version: u64` counter to `AudioParams` (incremented on every mutation). Return it as an `ETag` header on `GET /api/v1/state`. Reject `PATCH` requests that provide a stale `If-Match` ETag with HTTP 409 Conflict.

##### Why implement?
In a 7-bar pub, the operator at the main desk and the bar manager at bar 3 could simultaneously adjust the same channel. Without optimistic locking, the second write silently wins. With ETag, the second client gets a 409, re-fetches state, and retries with awareness of the current state.

##### Implementation notes
```rust
// In AudioParams:
pub version: u64,  // incremented atomically on each mutation

// In PATCH handler:
if let Some(etag) = headers.get("If-Match") {
    let client_version: u64 = etag.to_str()?.parse()?;
    if client_version != params.version { return StatusCode::CONFLICT.into_response(); }
}
params.version += 1;
```

---

## Additional Testing

### T-05 — Scene TOML schema_version field + migration logic

**Importance:** 🟡 Medium  
**Impact:** Saved scenes survive a software upgrade without silently loading corrupt state  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add `schema_version = 1` to every saved scene TOML. In `scene::load()`, check the version and run migration functions for older formats (e.g. if `schema_version` is missing, assume v0 and set defaults for new fields added in v1).

##### Why implement?
When EQ parameters (D-05) or compressor settings (D-06) are added, existing scene files won't have those fields. Without migration, `serde` will either error or silently use `Default` — both are wrong. Migration provides a clear upgrade path.

##### Implementation notes
```rust
#[derive(Deserialize)]
struct VersionedScene {
    schema_version: Option<u32>,
    #[serde(flatten)]
    inner: serde_json::Value,
}

fn load_with_migration(path: &Path) -> Result<AudioParams, SceneError> {
    let raw: VersionedScene = toml::from_str(&fs::read_to_string(path)?)?;
    match raw.schema_version.unwrap_or(0) {
        0 => migrate_v0_to_v1(raw.inner),
        1 => serde_json::from_value(raw.inner).map_err(Into::into),
        v => Err(SceneError::UnknownVersion(v)),
    }
}
```

---

*End of IMPROVEMENT_ROADMAP.md — 58 items total*
