# Minos V3 — Implementation Plan

## Status

**Build:** Clean (`cargo check --workspace` — 0 errors, 0 warnings).

**Completed sprints:**
- Sprint 0 ✅ — Ducker/LUFS wiring, warnings fixed
- Sprint 1 ✅ — Schema versioning, bulk mutations API, audit log, scene modal, multi-touch faders
- Sprint 2 ✅ — Scene scheduler, PTP health accuracy, config backup/restore UI, responsive CSS
- Sprint 3 ✅ — Ducker/LUFS API endpoints + UI panels, DSP presets UI, zone-scope enforcement in batch update

---

## Remaining Sprints

### Sprint 4 — RBAC + Health (next)

Run backend + frontend tracks in parallel.

**B4-1 — RBAC role enforcement**
- `check_min_role()` already defined in `auth_api.rs` (currently dead code)
- Wire `check_min_role(Role::Engineer)` onto all mutating routes (PUT, POST, DELETE)
- Wire `check_min_role(Role::Admin)` onto system/config endpoints
- `operator-ro` gets GET-only access to all audio routes
- Add test cases in `api_rbac.rs` (file exists — add missing scenarios)
- Return `403 Forbidden` with `{"error": "insufficient role"}` on denial

**B4-2 — Deep health endpoint**
- Extend `GET /api/v1/health` with:
  - `dante.card_present: bool`, `dante.rx_count`, `dante.tx_count`
  - `alsa.xruns: u64` (from `DspMetrics.xruns()`)
  - `dsp.cpu_percent` (already in `DspMetrics`)
  - `ptp.offset_ns` (from Sprint 2 PTP refactor)
- Update `HealthResponse` struct in `system.rs`

**F4-1 — Stacking toast queue**
- Replace single-slot `pb:toast` handler with a queue in `app.js` or `dashboard.js`
- Max 5 visible toasts; oldest auto-dismiss after 4s
- Severity colours: error=red, warn=amber, info=blue, success=green
- Animate in/out with CSS transitions

**F4-2 — Keyboard shortcuts overlay**
- Add `?` keydown listener in `app.js`
- Opens a `<dialog>` listing all keyboard shortcuts
- Shortcuts: `?` (help), `Escape` (close modal), `M` (mute focused), `S` (solo focused), `1-5` (tab switch)
- List existing matrix shortcuts (Shift+click exclusive solo, etc.)

**F4-3 — CSS token consolidation**
- Audit all CSS files for duplicated colour/spacing values
- Move all design tokens into `base.css :root` as CSS custom properties
- No hardcoded hex colours outside `base.css`
- Verify unified fader taper: all `sliderToDb`/`dbToSlider` usages use same math

---

### Sprint 5 — Testing

**T5-1 — DSP unit tests** (`crates/patchbox-core/tests/dsp_known_answer.rs`)
- Known-answer tests: biquad filter coefficients, compressor gain reduction at threshold, gate open/close, AFS detection on synthetic sine, DEQ band response

**T5-2 — API integration tests** (`crates/patchbox/tests/api_integration.rs`)
- Spin up real binary against temp config via `reqwest`
- Cover: login, full routing set/get, DSP chain round-trip, scene save/recall, WS metering frame

**T5-3 — State JSON snapshot** (`crates/patchbox/tests/state_snapshot.rs`)
- Use `insta` crate for golden snapshot of `GET /api/v1/config`

**T5-4 — Playwright UI smoke tests** (`e2e/smoke.spec.ts`)
- Login → Matrix (set crosspoint) → Mixer (toggle DSP block) → Scenes (save + recall)
- Wire into CI as separate `e2e` job

**T5-5 — Config loader fuzz** (`fuzz/fuzz_targets/fuzz_config_load.rs`)
- `cargo fuzz` target feeding random bytes to `PatchboxConfig::from_toml_str()`

**T5-6 — Matrix routing proptest** (`crates/patchbox-core/tests/matrix_proptest.rs`)
- Property: no feedback loops (bus→bus cycles not possible)
- Property: bus output order-independent for passive routes

---

### Sprint 6 — Tech Debt

**B6-1** — Collapse `input_dsp_to_value` / `output_dsp_to_value` helpers (~90% identical) into shared trait/macro. Files: `inputs.rs` + `outputs.rs`.

**B6-2** — Standardise all DSP GET/PUT to return config struct directly (no `{ block, params }` wrapper). Update OpenAPI annotations.

**B6-3** — Verify no `PATCH` calls mislabelled as `PUT` in `api.js`.

**F6-1** — All DSP section components (`eq-section.js`, `compressor-section.js`, etc.) should import `dsp-defaults.json` as fallback in `setState()`, not just `channel-strip.js`.

**F6-2** — Add `@typedef` JSDoc blocks in `api.js` for `ChannelDsp`, `SceneData`, `MeterFrame`, `HealthResponse`.

**F6-3** — HTML5 drag-to-reorder bus strips (`buses.js`) and signal generator rows. Persist via `PUT /api/v1/buses/:id/order` and `PUT /api/v1/generators/:id/order`.

---

### Sprint 7 — UI Polish

**F7-1** — Matrix search input (filter rows by channel name) + zone filter pills above output columns.

**F7-2** — Unrouted input → amber dot on matrix row header. Zone with no source → warning badge.

**F7-3** — `color: string` field on `ChannelConfig`; strip header + matrix label get left-border accent; colour picker in rename popover.

**F7-4** — Ballistics mode selector in System tab: VU (300ms RMS), PPM (10ms attack/slow decay), Digital Peak. Store in `localStorage`, change decay constant in `vu-meter.js`.

**F7-5** — ARIA roles/labels on all interactive elements, focus ring visibility, `aria-valuenow` on VU meters, WCAG AA contrast audit.

---

## Parallel Workstream Model

```
Sprint 4:  [B4-1 RBAC] [B4-2 Deep health]  ‖  [F4-1 Toast Q] [F4-2 Shortcuts] [F4-3 CSS tokens]
Sprint 5:  [T5-1..T5-6 — all independent, run in parallel]
Sprint 6:  [B6-1] [B6-2] [B6-3]  ‖  [F6-1] [F6-2] [F6-3]
Sprint 7:  [F7-1] [F7-2] [F7-3] [F7-4] [F7-5]
```

## Deferred (out of scope)

- MIDI / OSC control surface
- Undo / redo stack
- Recording / streaming tap
- RTA / spectrum analyzer
- HTTPS + Let's Encrypt
