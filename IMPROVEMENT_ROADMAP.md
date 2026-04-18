# Minos (dante-patchbox) — Improvement Roadmap

> **Document type:** Engineering review and improvement backlog  
> **Scope:** Scenes, Zones, Dante, and System tabs plus the backend/API/ops work required to make them production-grade. Matrix and Mixer are treated only as dependencies.  
> **Total items:** 55 (6 bug fixes + 49 improvements) — 5 resolved, 50 open  
> **Generated:** April 2026

## How to Read This Document

Each item is scored on four axes:

| Field | Meaning |
|---|---|
| **Importance** | 🔴 Critical (blocking/broken/security) · 🟠 High (significant operator pain or operational risk) · 🟡 Medium (clear product improvement) · 🟢 Low (polish / convenience / cleanup) |
| **Difficulty** | Easy (<2h) · Medium (half-day) · Hard (multi-day) |
| **Risk** | Low (localised) · Medium (cross-feature regressions possible) · High (runtime behaviour changes / rollback planning needed) |
| **Prerequisites** | Item IDs that should land first. `None` means independent. |

This document intentionally biases toward work that improves operator trust: accurate status, safe recall/apply flows, stronger RBAC, clearer failure states, and better recovery tooling.

## Resolved Items (5)

| ID | Category | Title | Status | Notes |
|---|---|---|---|---|
| RES-01 | Scenes | Diff preview and confirm-on-load modal | ✅ Implemented | `web/src/js/scenes.js` already shows a diff panel and confirm modal before destructive recalls. |
| RES-02 | Scenes | Rename / favourite / delete with undo | ✅ Implemented | Scene cards support rename, favourite toggle, delete, and undo wiring. |
| RES-03 | Zones | Zone drilldown panels with output masters | ✅ Implemented | Zone cards open a detail view with full output master strips. |
| RES-04 | System | Config export / import / backup list / restore UI | ✅ Implemented | The System tab already exposes export/import plus backup listing and restore actions. |
| RES-05 | System | Monitor output selector and solo controls baseline | ✅ Implemented | Monitor device selection and volume control are already wired through `/api/v1/system/monitor`. |

## Executive Summary

All 50 open items sorted by importance (Critical → High → Medium), then by difficulty (Easy → Medium → Hard).

| ID | Category | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|---|
| BUG-02 | Scenes | Validate scene names and metadata | 🔴 Critical | Easy | Low | None |
| BUG-03 | Security | Redact password hashes and secrets from config export/backup flows | 🔴 Critical | Easy | Medium | None |
| BUG-05 | Dante & Network | Fix `/api/v1/system` PTP/Dante truthfulness | 🔴 Critical | Easy | Low | None |
| BUG-04 | Security | Harden backup restore file trust model | 🔴 Critical | Medium | Medium | None |
| BUG-06 | Zones | Stabilise zone IDs after delete/reorder | 🔴 Critical | Medium | Medium | None |
| BUG-01 | Security | Enforce zone-scoped RBAC | 🔴 Critical | Hard | High | None |
| 3 | Scenes | Dirty-state indicator and unsaved-changes banner | 🟠 High | Easy | Low | None |
| 24 | System & Operations | Restart-required banner and pending-changes summary | 🟠 High | Easy | Low | None |
| 29 | Security | Single-source token storage and session lifecycle | 🟠 High | Easy | Low | None |
| 32 | Security | Cross-entity name validation | 🟠 High | Easy | Low | BUG-02 |
| 36 | Reliability & Observability | Persist-status banner for in-memory-only writes | 🟠 High | Easy | Low | None |
| 40 | Build, Testing & DX | Pin the Inferno git dependency | 🟠 High | Easy | Low | None |
| 1 | Scenes | Scene library metadata, saved-by, timestamps, notes, and filter/sort | 🟠 High | Medium | Low | None |
| 2 | Scenes | Full-fidelity scene diff | 🟠 High | Medium | Low | None |
| 8 | Zones | Zone CRUD/editor UI | 🟠 High | Medium | Medium | BUG-06 |
| 9 | Zones | Bulk zone operations | 🟠 High | Medium | Medium | 8 |
| 10 | Zones | Zone metering and clip state | 🟠 High | Medium | Low | None |
| 13 | Zones | Staff-mode deep links / kiosk surface | 🟠 High | Medium | Medium | BUG-01, 8 |
| 14 | Zones | Stereo-paired zone behaviour | 🟠 High | Medium | Medium | 8 |
| 15 | Dante & Network | Replace the placeholder Dante tab with a diagnostics dashboard | 🟠 High | Medium | Low | BUG-05 |
| 16 | Dante & Network | PTP trend/history card | 🟠 High | Medium | Low | BUG-05, 15 |
| 19 | Dante & Network | Manual rescan / rebind / Dante-engine restart actions | 🟠 High | Medium | High | 15 |
| 20 | Dante & Network | Network event log | 🟠 High | Medium | Low | 15 |
| 22 | System & Operations | Guided config workflow | 🟠 High | Medium | Low | None |
| 23 | System & Operations | Dry-run config validator with diff preview | 🟠 High | Medium | Low | 22 |
| 25 | System & Operations | Safe apply/rollback for channel and bus-count changes | 🟠 High | Hard | High | 23, 24 |
| 27 | System & Operations | Audit log UI and download | 🟠 High | Medium | Medium | None |
| 30 | Security | Login brute-force throttling and auth audit events | 🟠 High | Medium | Low | None |
| 31 | Security | Restrict public OpenAPI/config/health exposure | 🟠 High | Medium | Medium | None |
| 34 | Security | Export/import scopes that exclude users and secrets | 🟠 High | Medium | Medium | BUG-03 |
| 35 | Reliability & Observability | Bulk-mutations API | 🟠 High | Medium | Medium | None |
| 37 | Reliability & Observability | WebSocket reconnect/resync UX | 🟠 High | Medium | Low | None |
| 39 | Reliability & Observability | Prometheus/JSON metrics endpoint | 🟠 High | Medium | Low | None |
| 44 | Build, Testing & DX | Expand target-tab tests and retire stale frontend architecture | 🟠 High | Hard | Medium | None |
| 5 | Scenes | Partial recall scopes | 🟠 High | Hard | High | 2 |
| 6 | Scenes | Snapshot A/B compare and morph | 🟠 High | Hard | Medium | None |
| 17 | Dante & Network | Device roster and subscription health | 🟠 High | Hard | Medium | 15 |
| 4 | Scenes | Clone / Save As / duplicate scene | 🟡 Medium | Easy | Low | None |
| 11 | Zones | Zone DSP summary badges | 🟡 Medium | Easy | Low | None |
| 18 | Dante & Network | Compatibility checks (sample rate / AES67 / capacity) | 🟡 Medium | Medium | Low | 17 |
| 26 | System & Operations | Backup metadata and restore notes | 🟡 Medium | Medium | Low | 22 |
| 28 | System & Operations | Responsive/touch polish for non-matrix tabs | 🟡 Medium | Medium | Low | None |
| 33 | Security | WebSocket origin/trusted-host enforcement | 🟡 Medium | Medium | Medium | None |
| 38 | Reliability & Observability | Background task status events | 🟡 Medium | Medium | Low | None |
| 41 | Build, Testing & DX | Pin Rust toolchain and reproducible build settings | 🟡 Medium | Easy | Low | None |
| 42 | Build, Testing & DX | Decouple mdbook/docs build from normal `cargo build` | 🟡 Medium | Medium | Low | None |
| 43 | Build, Testing & DX | Enforce Clippy/ESLint gates | 🟡 Medium | Medium | Low | None |
| 7 | Scenes | Scheduled recall rules | 🟡 Medium | Hard | Medium | 1 |
| 12 | Zones | Zone templates/presets | 🟡 Medium | Medium | Low | 8 |
| 21 | Dante & Network | Route-to-device trace | 🟡 Medium | Hard | Medium | 17 |

## Where to Start

### Top 5 Quick Wins (Easy difficulty, High or Critical importance)

1. **BUG-05 — Fix `/api/v1/system` PTP/Dante truthfulness**: the Dante and System tabs are currently built on a status model that can say "healthy enough" even when it is only echoing `dante_connected`.
2. **BUG-03 — Redact password hashes and secrets from export/backup flows**: closes a concrete confidentiality leak in the System tab's most operator-friendly workflow.
3. **BUG-02 — Validate scene names and metadata**: small change, immediate stability gain, and it unlocks every scene-library improvement that follows.
4. **Item 24 — Restart-required banner and pending-changes summary**: gives operators a clear answer to "did that change actually take effect yet?"
5. **Item 36 — Persist-status banner for in-memory-only writes**: exposes the exact failure mode already modelled by `persist_or_500!`, instead of leaving the UI to look successful after a failed write.

### Top 5 High-Impact Items (regardless of difficulty)

1. **BUG-01 — Enforce zone-scoped RBAC**: without this, "bar staff" is not meaningfully constrained and can change the wrong zone.
2. **BUG-06 — Stabilise zone IDs after delete/reorder**: zone management cannot become feature-complete while IDs break after topology edits.
3. **Item 15 — Dante diagnostics dashboard**: the Dante tab is currently too shallow to earn trust during faults or installs.
4. **Item 23 — Dry-run config validator with diff preview**: this makes the System tab safe enough to use for imports on a live box.
5. **Item 35 — Bulk-mutations API**: unlocks fast, safe batched operations for scenes, zones, and future tablet/staff workflows.

### Recommended Sequencing

- **Security baseline stack:** `BUG-03 → BUG-04 → BUG-01 → 31 → 33 → 34`
- **Scenes trust stack:** `BUG-02 → 1 → 2 → 3 → 5 → 6 → 7`
- **Zone-admin stack:** `BUG-06 → 8 → 9 → 12 → 13 → 14`
- **Dante truth stack:** `BUG-05 → 15 → 16 → 17 → 18 → 19 → 20 → 21`
- **System safe-change stack:** `22 → 23 → 24 → 25 → 26 → 27 → 36 → 38`
- **Reliability + CI stack:** `35 → 37 → 39 → 40 → 41 → 42 → 43 → 44`

## Dependency Map

```text
BUG-01  → (none)
BUG-02  → (none)
BUG-03  → (none)
BUG-04  → (none)
BUG-05  → (none)
BUG-06  → (none)
Item 1   → (none)
Item 2   → (none)
Item 3   → (none)
Item 4   → (none)
Item 5   → Item 2
Item 6   → (none)
Item 7   → Item 1
Item 8   → BUG-06
Item 9   → Item 8
Item 10  → (none)
Item 11  → (none)
Item 12  → Item 8
Item 13  → BUG-01, Item 8
Item 14  → Item 8
Item 15  → BUG-05
Item 16  → BUG-05, Item 15
Item 17  → Item 15
Item 18  → Item 17
Item 19  → Item 15
Item 20  → Item 15
Item 21  → Item 17
Item 22  → (none)
Item 23  → Item 22
Item 24  → (none)
Item 25  → Items 23, 24
Item 26  → Item 22
Item 27  → (none)
Item 28  → (none)
Item 29  → (none)
Item 30  → (none)
Item 31  → (none)
Item 32  → BUG-02
Item 33  → (none)
Item 34  → BUG-03
Item 35  → (none)
Item 36  → (none)
Item 37  → (none)
Item 38  → (none)
Item 39  → (none)
Item 40  → (none)
Item 41  → (none)
Item 42  → (none)
Item 43  → (none)
Item 44  → (none)
```

**Foundation items:** `BUG-01`, `BUG-02`, `BUG-03`, `BUG-04`, `BUG-05`, `BUG-06`, `1`, `2`, `3`, `4`, `10`, `11`, `22`, `24`, `27`, `28`, `29`, `30`, `31`, `33`, `35`, `36`, `37`, `38`, `39`, `40`, `41`, `42`, `43`, `44`

## Scenes

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|
| BUG-02 | Validate scene names and metadata | 🔴 Critical | Easy | Low | None |
| 1 | Scene library metadata, saved-by, timestamps, notes, and filter/sort | 🟠 High | Medium | Low | None |
| 2 | Full-fidelity scene diff | 🟠 High | Medium | Low | None |
| 3 | Dirty-state indicator and unsaved-changes banner | 🟠 High | Easy | Low | None |
| 4 | Clone / Save As / duplicate scene | 🟡 Medium | Easy | Low | None |
| 5 | Partial recall scopes | 🟠 High | Hard | High | 2 |
| 6 | Snapshot A/B compare and morph | 🟠 High | Hard | Medium | None |
| 7 | Scheduled recall rules | 🟡 Medium | Hard | Medium | 1 |

#### BUG-02 — Validate scene names and metadata

**Importance:** 🔴 Critical  
**Impact:** Prevents malformed scene records and makes later scene-library features deterministic.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Reject blank names, trim whitespace, cap length, and validate descriptions before a scene is written. Apply exactly the same rule set on save, rename, and any future import path.

##### Why implement?
`crates/patchbox/src/api/routes/scenes.rs` currently accepts essentially any name. That makes `SceneStore` keys unpredictable and creates unnecessary edge cases for duplicate detection, filtering, and stable URLs.

##### Why NOT implement (or defer)?
Overly strict validation can annoy operators who rely on punctuation-heavy naming. Keep the rule set broad enough for real venue labels and only block obviously bad input.

##### Implementation notes
Add shared validation in `crates/patchbox/src/api/routes/scenes.rs` for `SaveSceneRequest` and `UpdateSceneRequest`, then mirror it in `web/src/js/scenes.js`. Return structured `400` JSON so the modal can show a precise error.

---

#### Item 1 — Scene library metadata, saved-by, timestamps, notes, and filter/sort

**Importance:** 🟠 High  
**Impact:** Makes the Scenes tab usable as an actual library instead of a flat list of names.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Extend scene metadata with `created_at`, `updated_at`, `saved_by`, optional notes, and client-side filter/sort controls. Surface favourite-first, recent-first, and text filter modes in the scene list.

##### Why implement?
The current UI can store scenes, but operators cannot answer simple questions like "which scene is newest?" or "who last touched this?" Without that context, scenes become risky on a shared appliance.

##### Why NOT implement (or defer)?
Metadata does not directly improve audio quality. If the immediate goal is only fault correction, this can wait behind status and safety work.

##### Implementation notes
Add metadata fields to `Scene` in `crates/patchbox/src/scenes.rs`, populate them from auth claims in the save path, and persist them in `config.toml.scenes.toml`. Extend `web/src/js/scenes.js` list rendering and store sort preference in `localStorage`.

---

#### Item 2 — Full-fidelity scene diff

**Importance:** 🟠 High  
**Impact:** Turns the current diff panel into a reliable recall-safety tool instead of a partial hint.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Expand `/api/v1/scenes/:id/diff` so it compares matrix gain, output mutes, buses, and any scene-managed DSP fields, not just the legacy route/gain subset. Show grouped changes in the UI rather than one flat list.

##### Why implement?
`get_scene_diff()` in `crates/patchbox/src/api/routes/scenes.rs` does not reflect the real surface area of a live recall. Operators are being asked to trust a preview that omits meaningful changes.

##### Why NOT implement (or defer)?
The data model is wider than the current diff response, so the implementation touches both backend and frontend. If the team wants only fast UI polish, it is more than a cosmetic change.

##### Implementation notes
Add diff sections for `matrix_gain_db`, `output_muted`, `bus_matrix`, and any newly managed scene metadata. In `web/src/js/scenes.js`, render grouped sections like Routing, Gains, Buses, and Mutes instead of a single "field: old → new" list.

---

#### Item 3 — Dirty-state indicator and unsaved-changes banner

**Importance:** 🟠 High  
**Impact:** Reduces accidental scene loss and makes the operator's current state obvious.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Track whether the live state has diverged from the active scene and show a small "unsaved changes" badge in the Scenes tab and top shell. Clear it after save or after loading a scene that matches the current state.

##### Why implement?
Today there is no fast visual answer to "am I still on the saved state?" That creates hesitation around scene recall and increases the chance of overwriting useful live adjustments.

##### Why NOT implement (or defer)?
The heuristic must be well chosen or it will flicker on harmless changes like meter-only updates. Keep the comparison scoped to persisted state only.

##### Implementation notes
Use the same core comparison data as Item 2, but memoise a boolean dirty flag in `web/src/js/state.js`. Update it after `api.put*`, route changes, scene load, and scene save; render a lightweight banner in `web/src/js/scenes.js` and the shell.

---

#### Item 4 — Clone / Save As / duplicate scene

**Importance:** 🟡 Medium  
**Impact:** Speeds up common workflow where operators create variants from a nearby scene instead of rebuilding from scratch.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a Clone/Save As action on each scene card that copies the selected scene under a new validated name. Optionally let the user clone the active scene without first loading it.

##### Why implement?
The current flow only supports "save current" or "rename existing". That is clumsy for common variants like weekday/weekend or speech/music variants.

##### Why NOT implement (or defer)?
It is convenience, not platform safety. If time is tight, ship the trust/safety work first.

##### Implementation notes
Expose a `POST /api/v1/scenes/:id/clone` endpoint or reuse existing save/get endpoints server-side. In `web/src/js/scenes.js`, add a modal that pre-fills the source name and optional description.

---

#### Item 5 — Partial recall scopes

**Importance:** 🟠 High  
**Impact:** Lets operators recall useful parts of a scene without clobbering everything else.  
**Difficulty:** Hard  
**Risk:** High  
**Prerequisites:** 2

##### What is it?
Add per-recall toggles such as Routing only, Gains only, DSP only, Mutes only, or Selected zones only. The selected subset becomes the exact plan applied by the scene loader.

##### Why implement?
This is one of the highest-value workflow upgrades for real venues. A full recall is often too destructive, but partial recall makes scenes useful during live operation rather than only during preset changes.

##### Why NOT implement (or defer)?
Selective recall changes how scenes are understood and tested. It needs excellent preview and very clear UX to avoid "I thought this scene would change X but not Y" incidents.

##### Implementation notes
Extend `Scene::apply_to_config()` in `crates/patchbox/src/scenes.rs` to accept a scope object instead of always applying the full snapshot. Feed the same scope object from a new recall modal in `web/src/js/scenes.js`, backed by the richer diff from Item 2.

---

#### Item 6 — Snapshot A/B compare and morph

**Importance:** 🟠 High  
**Impact:** Makes scenes useful as an iterative tuning tool, not just a static preset store.  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Provide two temporary scene slots and a morph/crossfade control between them. The UI should show which slot is active and allow instant A/B or timed interpolation.

##### Why implement?
This was already accepted into the project backlog because it materially improves tuning, especially for zone-level loudness and routing comparisons. It also pairs naturally with the existing crossfade groundwork.

##### Why NOT implement (or defer)?
It is feature work rather than a correctness fix. If current recall safety is still weak, shipping morphing first could amplify operator confusion.

##### Implementation notes
Keep the scaffolding in `crates/patchbox/src/ab_compare.rs`, reuse existing `scene_crossfade_ms` concepts where possible, and expose a focused UI only in the Scenes tab. Treat morphing as an explicit command, not as hidden implicit state.

---

#### Item 7 — Scheduled recall rules

**Importance:** 🟡 Medium  
**Impact:** Automates repetitive state changes such as open/close scenes or night-mode presets.  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** 1

##### What is it?
Add a simple scheduler for time-based scene recall with weekday rules, enable/disable toggles, and blackout windows. The UI should clearly show upcoming runs and the last execution result.

##### Why implement?
Repeated operational transitions are a strong fit for automation, especially on fixed-install systems. It also nudges scenes toward being a managed library rather than ad hoc snapshots.

##### Why NOT implement (or defer)?
Time-based actions can be dangerous if clock status is wrong or venue rules change unexpectedly. Do not ship it before PTP/system truthfulness and audit visibility are improved.

##### Implementation notes
Persist schedule entries in config, execute them in a background task, and write every run to the audit log. In the UI, keep rules editable from the Scenes tab rather than hiding them in System.

---

## Zones

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|
| BUG-06 | Stabilise zone IDs after delete/reorder | 🔴 Critical | Medium | Medium | None |
| 8 | Zone CRUD/editor UI | 🟠 High | Medium | Medium | BUG-06 |
| 9 | Bulk zone operations | 🟠 High | Medium | Medium | 8 |
| 10 | Zone metering and clip state | 🟠 High | Medium | Low | None |
| 11 | Zone DSP summary badges | 🟡 Medium | Easy | Low | None |
| 12 | Zone templates/presets | 🟡 Medium | Medium | Low | 8 |
| 13 | Staff-mode deep links / kiosk surface | 🟠 High | Medium | Medium | BUG-01, 8 |
| 14 | Stereo-paired zone behaviour | 🟠 High | Medium | Medium | 8 |

#### BUG-06 — Stabilise zone IDs after delete/reorder

**Importance:** 🔴 Critical  
**Impact:** Prevents the Zones tab from corrupting its own addressing after topology changes.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Make zone IDs stable and independent from array index position. Deleting or reordering a zone must not make later edits point at the wrong resource or 404 unexpectedly.

##### Why implement?
`parse_zone_id()` and `put_zone_resource()` currently treat `zone_N` as both identifier and array index. Once `cfg.zone_config.remove(i)` runs, the remaining IDs no longer line up with their storage position.

##### Why NOT implement (or defer)?
The fix is structural and may require a migration path for existing configs. That adds some caution compared with a pure UI patch.

##### Implementation notes
Treat `ZoneConfig.id` as the primary key and stop deriving server identity from array position in `crates/patchbox/src/api/routes/zones.rs`. Add a migration that preserves old IDs and a regression test covering delete + edit + reorder.

---

#### Item 8 — Zone CRUD/editor UI

**Importance:** 🟠 High  
**Impact:** Makes Zones feature-complete enough to manage the real venue topology from the product, not from TOML.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** BUG-06

##### What is it?
Add create, rename, recolour, and TX-assignment editing to the Zones tab. The zone card grid should become the main place operators shape zone topology.

##### Why implement?
The backend already exposes `/api/v1/zones` CRUD, but the current UI mostly treats zones as fixed objects. That leaves a large part of the feature set stranded behind config edits.

##### Why NOT implement (or defer)?
Changing zone membership is more dangerous than muting a zone. Without stable IDs and clear confirmation UX, it becomes a source of routing mistakes.

##### Implementation notes
Use a modal or side drawer in `web/src/js/zones.js` backed by `postZone()` and `putZoneResource()`. Let users assign `tx_ids` by selecting outputs from `st.outputList()` rather than typing IDs manually.

---

#### Item 9 — Bulk zone operations

**Importance:** 🟠 High  
**Impact:** Cuts repetitive work when multiple zones need the same source, mute, or trim change.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** 8

##### What is it?
Add multi-select or scope-based actions such as mute selected zones, set one source across several zones, or apply a trim offset to many zones. Keep zone-safe confirmations for destructive bulk changes.

##### Why implement?
The current Zones tab is efficient for one zone at a time only. In fixed installs, operators often need "all bar TVs to source X" or "reduce patio group by 3 dB" style moves.

##### Why NOT implement (or defer)?
Bulk actions multiply the blast radius of mistakes. They should not ship before zone identity and undo semantics are reliable.

##### Implementation notes
Pair this with Item 35's bulk-mutations backend. In the UI, show an explicit scope pill list and a preview like "will affect 4 zones / 8 outputs" before sending the request.

---

#### Item 10 — Zone metering and clip state

**Importance:** 🟠 High  
**Impact:** Gives the Zones tab real operational visibility instead of making users jump back to Mixer/System.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Show compact meters and clip indicators on each zone card and in the zone detail panel. Surface the worst output in the zone even when several TX outputs belong to the same zone.

##### Why implement?
Zone control without level visibility is incomplete. The current drilldown is useful, but the grid view cannot answer "which zone is active or clipping?" at a glance.

##### Why NOT implement (or defer)?
Extra metering in the zone grid adds rendering load. Keep the display compact and reuse the existing metering pipeline instead of inventing a second one.

##### Implementation notes
Aggregate `tx_*` meter data in `web/src/js/zones.js` and reuse existing meter rendering helpers from `mixer.js`/`metering.js`. Show peak hold and clip state only, not full mixer-style strips, in the grid cards.

---

#### Item 11 — Zone DSP summary badges

**Importance:** 🟡 Medium  
**Impact:** Makes it obvious which zones have EQ/limiter/delay treatment without opening each detail panel.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add small status badges for output EQ, limiter, delay, mute, and stereo link state on zone cards. Clicking a badge should deep-link into the relevant zone/output control.

##### Why implement?
Today a zone can sound different for hidden reasons. A concise DSP summary reduces the guesswork when troubleshooting one odd-sounding area.

##### Why NOT implement (or defer)?
Badge overload can make the zone cards noisy. Limit it to high-signal state rather than every possible DSP block.

##### Implementation notes
Derive badge state from `st.state.outputs` and existing DSP configs, not from extra API calls. Use the same visual language already established for Matrix/Mixer DSP badges.

---

#### Item 12 — Zone templates/presets

**Importance:** 🟡 Medium  
**Impact:** Speeds up repetitive deployments and makes new zone creation less error-prone.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** 8

##### What is it?
Allow a new zone to be created from a preset such as "bar stereo pair", "mono speech zone", or "patio music feed". Templates should pre-fill name pattern, colour, TX structure, and common DSP defaults.

##### Why implement?
Many installs reuse the same zone shapes. Templates save time and reduce the chance of forgetting a limiter, stereo link, or standard naming rule.

##### Why NOT implement (or defer)?
Templates only pay off once zone editing exists. Before Item 8, there is nowhere sensible to apply them.

##### Implementation notes
Keep templates as simple JSON/TOML definitions in-app rather than a second complex editor. Start with a few built-ins and allow future import/export later if adoption proves strong.

---

#### Item 13 — Staff-mode deep links / kiosk surface

**Importance:** 🟠 High  
**Impact:** Turns Zones into a usable day-to-day control surface for staff instead of only an admin convenience.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** BUG-01, 8

##### What is it?
Expose direct zone URLs or a kiosk mode that shows only the assigned zone controls for a role-limited user. The UI should remove unrelated tabs and keep the interaction surface large and simple.

##### Why implement?
The product already has role concepts and zone ownership aspirations. A proper staff mode converts that into a real operational feature instead of a notional auth model.

##### Why NOT implement (or defer)?
It is not safe until RBAC is truly zone-scoped. Shipping a kiosk UI without backend enforcement would create a false sense of safety.

##### Implementation notes
Use auth claims to decide which zone to load first and which controls to hide. Reuse `zone.html` or add a slim shell mode rather than cloning a second full frontend.

---

#### Item 14 — Stereo-paired zone behaviour

**Importance:** 🟠 High  
**Impact:** Prevents left/right drift and makes zone-level controls behave like operators expect on stereo destinations.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** 8

##### What is it?
Add explicit paired-zone behaviour so linked left/right outputs move together for source, mute, trim, and safe recalls. Show the pairing clearly in the zone card and detail view.

##### Why implement?
The product already has stereo-link concepts elsewhere, but zone workflows still treat several common stereo destinations like unrelated outputs. That creates easy-to-miss imbalance bugs.

##### Why NOT implement (or defer)?
Not every zone should be forced into pairing semantics. The feature needs opt-in configuration and obvious visual labelling.

##### Implementation notes
Reuse existing stereo-link data where possible instead of inventing a second model. The Zones tab should read and set paired state rather than hiding it behind Mixer-only semantics.

---

## Dante & Network

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|
| BUG-05 | Fix `/api/v1/system` PTP/Dante truthfulness | 🔴 Critical | Easy | Low | None |
| 15 | Replace the placeholder Dante tab with a diagnostics dashboard | 🟠 High | Medium | Low | BUG-05 |
| 16 | PTP trend/history card | 🟠 High | Medium | Low | BUG-05, 15 |
| 17 | Device roster and subscription health | 🟠 High | Hard | Medium | 15 |
| 18 | Compatibility checks (sample rate / AES67 / capacity) | 🟡 Medium | Medium | Low | 17 |
| 19 | Manual rescan / rebind / Dante-engine restart actions | 🟠 High | Medium | High | 15 |
| 20 | Network event log | 🟠 High | Medium | Low | 15 |
| 21 | Route-to-device trace | 🟡 Medium | Hard | Medium | 17 |

#### BUG-05 — Fix `/api/v1/system` PTP/Dante truthfulness

**Importance:** 🔴 Critical  
**Impact:** Restores operator trust in the Dante and System tabs by making them report real state.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Stop deriving `ptp_locked` in `/api/v1/system` from `dante_connected`. Report actual statime/observation state consistently with the richer `/api/v1/health` endpoint.

##### Why implement?
The current implementation in `crates/patchbox/src/api/routes/system.rs` can tell a comfortable lie. That makes every downstream UI built on `/api/v1/system` less trustworthy than it looks.

##### Why NOT implement (or defer)?
There is almost no good reason to defer this. The only real care point is avoiding extra blocking I/O in a frequently hit path.

##### Implementation notes
Share the PTP/Dante status helper between `get_health()` and `get_system()` so the product has one source of truth. Return both a coarse status and the raw state/offset fields needed for richer UI later.

---

#### Item 15 — Replace the placeholder Dante tab with a diagnostics dashboard

**Importance:** 🟠 High  
**Impact:** Makes the Dante tab useful during install, troubleshooting, and support instead of being a thin status card.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** BUG-05

##### What is it?
Rebuild `web/src/js/dante.js` around cards for Dante link, PTP, device discovery, active routes, engine health, and recent events. The tab should answer "is the network side healthy?" without forcing users into System plus SSH.

##### Why implement?
Right now the Dante tab is effectively a pretty table of the same fields already shown elsewhere. That is the clearest placeholder in the target scope.

##### Why NOT implement (or defer)?
A diagnostics dashboard needs backend support, not just styling. If the team wants only UI completion this sprint, some backend-first items must still land.

##### Implementation notes
Use `/api/v1/health` as the seed model, then add any missing Dante-specific fields to a dedicated endpoint if needed. Keep the dashboard read-mostly and reserve control actions for explicit admin buttons.

---

#### Item 16 — PTP trend/history card

**Importance:** 🟠 High  
**Impact:** Helps distinguish a healthy lock from a barely-holding lock that is about to fail.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** BUG-05, 15

##### What is it?
Add a small rolling view of PTP state, offset, lock duration, and last state transition. Show degraded states before they become complete loss-of-lock incidents.

##### Why implement?
A single current value is not enough for support. Operators need to see whether offset is stable, improving, or bouncing around.

##### Why NOT implement (or defer)?
Trend views add more polling/state retention complexity. If the observation source is still unreliable, this just visualises noise.

##### Implementation notes
Cache a small rolling window in memory and expose it on the Dante dashboard only, not on every tab. Use colour changes sparingly and reserve red only for actionable faults.

---

#### Item 17 — Device roster and subscription health

**Importance:** 🟠 High  
**Impact:** Gives Minos a real picture of the Dante environment it depends on.  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** 15

##### What is it?
Show discovered Dante devices, their online state, channel counts, and any known subscription or route issues. Pair that with Minos-side knowledge of which routes are expected to exist.

##### Why implement?
When the network side breaks, users currently need external tools to know whether the problem is Minos, the clock, or another Dante node. A built-in roster reduces that context switch.

##### Why NOT implement (or defer)?
True subscription health can require deeper protocol knowledge and careful polling/event integration. It is a real backend feature, not a cheap frontend patch.

##### Implementation notes
Build on existing `patchbox-dante` monitoring hooks if they already exist, otherwise expose a dedicated diagnostic model from the backend. Keep the UI focused on actionable health, not every raw protocol detail.

---

#### Item 18 — Compatibility checks (sample rate / AES67 / capacity)

**Importance:** 🟡 Medium  
**Impact:** Prevents obvious misconfiguration before it turns into a silent failure or distorted path.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** 17

##### What is it?
Add warnings for sample-rate mismatch, suspected AES67 incompatibility, and capacity mismatches between configured routes and discovered devices. Present them as advisories rather than hard blocks unless the path is clearly impossible.

##### Why implement?
These are exactly the kinds of issues that frustrate installs because nothing "looks broken" in the simple UI. A compatibility layer adds expert guidance without forcing users into packet captures first.

##### Why NOT implement (or defer)?
Heuristic warnings can be noisy if the underlying device data is incomplete. Keep the checks conservative and label confidence clearly.

##### Implementation notes
Implement the checks server-side so they can be tested and logged. Surface them in the Dante tab near the relevant device or route rather than dumping them into a generic alert bucket.

---

#### Item 19 — Manual rescan / rebind / Dante-engine restart actions

**Importance:** 🟠 High  
**Impact:** Gives operators a supported recovery path for transient network failures.  
**Difficulty:** Medium  
**Risk:** High  
**Prerequisites:** 15

##### What is it?
Add explicit admin actions to rescan devices, rebind the Dante interface, or restart the Dante engine. Each action should explain expected disruption and ask for confirmation.

##### Why implement?
Today the support answer is likely "SSH in and restart things." A product-grade Dante tab needs controlled recovery actions with clear blast radius.

##### Why NOT implement (or defer)?
These actions can interrupt audio. If they are too easy to click or poorly described, they become a new outage source.

##### Implementation notes
Keep all recovery actions in a clearly separated admin card on the Dante tab. Emit task status events (Item 38) and log the initiating user and duration to the audit log.

---

#### Item 20 — Network event log

**Importance:** 🟠 High  
**Impact:** Gives support and operators a timeline of what changed when the audio path went wrong.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** 15

##### What is it?
Record events like device offline/online, PTP state changes, resync spikes, and manual recovery actions, then show them in reverse chronological order. Keep the feed small and high-signal.

##### Why implement?
A flat current-state dashboard is weak after the fact. Operators need event context to explain why a route worked at 18:00 and failed at 18:07.

##### Why NOT implement (or defer)?
Bad event hygiene turns into log spam. Only record events with clear operational meaning.

##### Implementation notes
Use structured events in the backend and store a bounded history ring plus a persisted audit form for critical events. The Dante tab should support copy/export of the recent list for support cases.

---

#### Item 21 — Route-to-device trace

**Importance:** 🟡 Medium  
**Impact:** Makes troubleshooting faster by showing the full path from Minos routing intent to Dante network destination.  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** 17

##### What is it?
Let a user inspect a route and see the configured Minos source/output, the associated Dante device/channel mapping, and any current health warnings. Think "trace this output" rather than "show me every device."

##### Why implement?
Support work is often route-centric, not device-centric. A trace view shortens the mental gap between the matrix model and the network model.

##### Why NOT implement (or defer)?
It is only useful once the device roster and health model are solid. Otherwise it becomes an incomplete diagram that still sends users to Dante Controller.

##### Implementation notes
Start with read-only trace output on click from the Dante dashboard or zone card. Reuse Item 17 device data and Item 20 event data rather than inventing another backend store.

---

## System & Operations

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|
| 22 | Guided config workflow | 🟠 High | Medium | Low | None |
| 23 | Dry-run config validator with diff preview | 🟠 High | Medium | Low | 22 |
| 24 | Restart-required banner and pending-changes summary | 🟠 High | Easy | Low | None |
| 25 | Safe apply/rollback for channel and bus-count changes | 🟠 High | Hard | High | 23, 24 |
| 26 | Backup metadata and restore notes | 🟡 Medium | Medium | Low | 22 |
| 27 | Audit log UI and download | 🟠 High | Medium | Medium | None |
| 28 | Responsive/touch polish for non-matrix tabs | 🟡 Medium | Medium | Low | None |

#### Item 22 — Guided config workflow

**Importance:** 🟠 High  
**Impact:** Reduces confusion in the System tab by turning several overlapping backup/import/export affordances into one safe workflow.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Collapse the duplicate config sections into a clearer workflow: export current, inspect backups, upload candidate, validate candidate, restore candidate, restart/apply. Use one consistent vocabulary and one place for warnings.

##### Why implement?
`web/src/js/system.js` currently exposes overlapping controls for export/import and backup/restore. It is functional, but the flow is harder to understand than it needs to be.

##### Why NOT implement (or defer)?
This is mostly UX cleanup. If time is tight, it can wait behind trust and correctness bugs.

##### Implementation notes
Refactor the System tab into explicit sections backed by the existing API surface instead of duplicating action cards. Keep all config-changing actions in a single visible "danger zone" area with shared confirmation language.

---

#### Item 23 — Dry-run config validator with diff preview

**Importance:** 🟠 High  
**Impact:** Makes import/restore safe enough to use on a live appliance.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** 22

##### What is it?
Add a non-destructive validation endpoint that parses a candidate config, normalises it, reports any errors, and shows the effective diff before apply. The UI should not replace live config until the user explicitly confirms.

##### Why implement?
The current restore flow applies a file, creates a backup, and tells the user a restart is recommended. That is too much trust for a one-click path carrying the whole system configuration.

##### Why NOT implement (or defer)?
It adds another API surface and one more UI branch to maintain. If config import is rarely used, the ROI is operational rather than daily.

##### Implementation notes
Expose a `/api/v1/system/config/validate` or similar endpoint and reuse the same diff rendering pattern as the Scenes work. Validation should include schema, normalisation changes, and any fields that would be dropped or redacted.

---

#### Item 24 — Restart-required banner and pending-changes summary

**Importance:** 🟠 High  
**Impact:** Makes "saved" versus "active after restart" explicit.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Track when a config change requires a restart or engine rebind and show a persistent banner until it is cleared. Summarise which settings are pending so the operator knows why the banner exists.

##### Why implement?
The System tab already triggers a restart overlay for some actions, but there is no durable notion of restart-required state. Operators can leave the tab unsure whether the box is fully applied.

##### Why NOT implement (or defer)?
Some settings may eventually become hot-reloadable, so the rule set must stay honest. Avoid a generic banner that fires for everything.

##### Implementation notes
Add a small pending-changes model in the backend and expose it on `/api/v1/system`. The frontend should show both the banner and a short list like "RX/TX count changed" or "monitor device changed".

---

#### Item 25 — Safe apply/rollback for channel and bus-count changes

**Importance:** 🟠 High  
**Impact:** Turns the most disruptive System-tab operation into a controlled, reversible workflow.  
**Difficulty:** Hard  
**Risk:** High  
**Prerequisites:** 23, 24

##### What is it?
Wrap RX/TX/bus topology changes in a staged apply flow with backup, validation, apply, health check, and rollback path. If the post-apply health check fails, revert to the known-good config automatically or with one click.

##### Why implement?
`postAdminChannels()` is one of the highest-risk buttons in the UI. It can change the whole shape of the appliance, yet the current UX is essentially "save and restart".

##### Why NOT implement (or defer)?
This is real control-plane work and touches restart semantics. It needs careful staging and testing, especially on live Dante hardware.

##### Implementation notes
Create a server-side transaction model: snapshot backup, validate target config, apply, wait for health conditions, then either commit or revert. The System tab should show a progress state rather than an unconditional spinner overlay.

---

#### Item 26 — Backup metadata and restore notes

**Importance:** 🟡 Medium  
**Impact:** Makes backups understandable and safer to choose under pressure.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** 22

##### What is it?
Store who triggered a backup, which version created it, optional notes, and a short summary of what changed. Show that metadata in the backup list instead of only timestamped filenames.

##### Why implement?
A bare list of timestamped `.toml` names is better than nothing, but it does not tell operators which backup is "before the stage change" or "after Tuesday tuning".

##### Why NOT implement (or defer)?
It is an operator-quality improvement rather than a correctness fix. If the restore path itself still needs hardening, do that first.

##### Implementation notes
Persist metadata alongside the backup or embed it in a small manifest. Extend `get_config_backups()` to return structured data and render notes in `web/src/js/system.js`.

---

#### Item 27 — Audit log UI and download

**Importance:** 🟠 High  
**Impact:** Gives the System tab a real operational history instead of leaving support to journalctl and memory.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Record user, action, target, before/after summary, and timestamp for all state-changing system, scene, zone, and security actions. Expose a filterable UI table and download/export action.

##### Why implement?
Both the repo roadmap and external research point to auditability as a high-value next step. It is especially important once staff-mode and scheduled actions exist.

##### Why NOT implement (or defer)?
Audit trails are only useful if they are accurate and low-noise. Do not ship a log that records button clicks without meaningful context.

##### Implementation notes
Use `tracing` or a dedicated append-only store; include auth claim data in the write path. Start with System/Scenes/Zones mutations, then expand to Dante recovery actions once those exist.

---

#### Item 28 — Responsive/touch polish for non-matrix tabs

**Importance:** 🟡 Medium  
**Impact:** Makes Scenes, Zones, Dante, and System feel deliberate on the 1080p touch deployment target instead of merely functional.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Clean up hit targets, panel spacing, stacked card layouts, and overflow behaviour for the non-matrix tabs. Focus on the flows staff or operators are most likely to use on a touchscreen.

##### Why implement?
The user has already steered a lot of visual work toward a real touchscreen deployment. The remaining tabs still read more like admin panels than polished operational surfaces.

##### Why NOT implement (or defer)?
Responsiveness can absorb time if done broadly. Keep the work limited to the target tabs rather than reopening Matrix/Mixer layout work.

##### Implementation notes
Audit `web/src/css/scenes.css`, `zones.css`, `dante.css`, and `system.css` for touch target size, card stacking, and button density. Add a few Playwright checks at the target viewport once the UX stabilises.

---

## Security & Access Control

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|
| BUG-01 | Enforce zone-scoped RBAC | 🔴 Critical | Hard | High | None |
| BUG-03 | Redact password hashes and secrets from config export/backup flows | 🔴 Critical | Easy | Medium | None |
| BUG-04 | Harden backup restore file trust model | 🔴 Critical | Medium | Medium | None |
| 29 | Single-source token storage and session lifecycle | 🟠 High | Easy | Low | None |
| 30 | Login brute-force throttling and auth audit events | 🟠 High | Medium | Low | None |
| 31 | Restrict public OpenAPI/config/health exposure | 🟠 High | Medium | Medium | None |
| 32 | Cross-entity name validation | 🟠 High | Easy | Low | BUG-02 |
| 33 | WebSocket origin/trusted-host enforcement | 🟡 Medium | Medium | Medium | None |
| 34 | Export/import scopes that exclude users and secrets | 🟠 High | Medium | Medium | BUG-03 |

#### BUG-01 — Enforce zone-scoped RBAC

**Importance:** 🔴 Critical  
**Impact:** Turns the current role model into a real security boundary instead of a UI hint.  
**Difficulty:** Hard  
**Risk:** High  
**Prerequisites:** None

##### What is it?
Use the zone claim in JWTs to restrict which zone, route, mute, and scene actions a limited user can perform. A zone-scoped user must not be able to affect unrelated TX outputs through generic endpoints.

##### Why implement?
The security audit found the core gap: claims carry zone information, but route handlers largely enforce only broad role level. That makes staff mode impossible to trust.

##### Why NOT implement (or defer)?
RBAC bugs are easy to get half-right. This needs endpoint-level tests, not just middleware changes.

##### Implementation notes
Add helper extraction for auth claims and validate the target zone/tx set inside zone, route, and scene handlers. Add explicit tests proving that a zone-limited user cannot change another zone through direct API calls.

---

#### BUG-03 — Redact password hashes and secrets from config export/backup flows

**Importance:** 🔴 Critical  
**Impact:** Prevents the System tab's friendly backup/export workflow from leaking security-sensitive material.  
**Difficulty:** Easy  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Stop returning password hashes, JWT secrets, or any future secret-bearing fields in the normal export and backup download paths. Provide a separate privileged escape hatch only if raw secret export is ever truly needed.

##### Why implement?
`get_system_config_export()` and backup download flows serialise config too literally for a production appliance. A support-friendly export should default to safe, not complete.

##### Why NOT implement (or defer)?
Some operators may expect exact round-trip backups. If so, keep a clearly labelled full-fidelity path behind extra confirmation and admin-only scope.

##### Implementation notes
Create a redacted export struct instead of serialising `PatchboxConfig` directly. Update `web/src/js/system.js` labels so "Download backup" clearly means a safe operational export unless an explicit full-export mode is chosen.

---

#### BUG-04 — Harden backup restore file trust model

**Importance:** 🔴 Critical  
**Impact:** Reduces the chance of restoring the wrong file or following an unsafe path during backup operations.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Treat backup restore as a trusted-file workflow, not just "read whatever filename matches a loose check". Validate extension, canonical location, symlink status, and ownership before reading a backup candidate.

##### Why implement?
The current `name.contains('/')` / `name.contains("..")` guard is better than nothing, but it is not a full trust model. Restore paths deserve stricter handling than ordinary reads.

##### Why NOT implement (or defer)?
The extra filesystem checks are slightly more code and can be platform-specific. Even so, this is worthwhile because the path is security-sensitive and operator-facing.

##### Implementation notes
Use `symlink_metadata`, canonical-parent allowlisting, and strict filename matching on the server side. Pair it with clearer error messages in the System tab so operators know why a restore was refused.

---

#### Item 29 — Single-source token storage and session lifecycle

**Importance:** 🟠 High  
**Impact:** Reduces auth edge cases and makes session behaviour predictable across tabs and reloads.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Pick one browser storage strategy for the JWT and standardise refresh/logout behaviour around it. Remove duplicated token assumptions from old/new frontend codepaths.

##### Why implement?
The audits found mixed token handling patterns in the frontend history. That is a common source of "it worked until reload" behaviour, especially in a partly migrated UI.

##### Why NOT implement (or defer)?
If the frontend architecture is about to be heavily consolidated, you may prefer to fix this alongside that larger cleanup. Still, the change itself is small and high leverage.

##### Implementation notes
Keep token access centralised in `web/src/js/api.js` and remove any parallel storage usage from older codepaths. Decide explicitly whether sessions should survive a browser restart on the deployment target.

---

#### Item 30 — Login brute-force throttling and auth audit events

**Importance:** 🟠 High  
**Impact:** Makes auth failures visible and slows low-effort guessing on an exposed LAN appliance.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add per-user and per-IP login throttling plus structured logs for successful and failed auth attempts. Surface the recent auth activity in the audit log download.

##### Why implement?
Generic request rate limiting is not the same thing as credential protection. Authentication deserves narrower controls and visibility.

##### Why NOT implement (or defer)?
Poorly tuned lockouts can frustrate legitimate operators. Keep the throttle soft and observable rather than punitive.

##### Implementation notes
Implement a separate limiter in `auth_api.rs` for `/api/v1/login` and `/api/v1/auth/refresh`. Log username, source IP, result, and reason without logging raw secrets.

---

#### Item 31 — Restrict public OpenAPI/config/health exposure

**Importance:** 🟠 High  
**Impact:** Cuts down on unnecessary topology and capability leakage from the appliance.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Review which diagnostic surfaces should be public, viewer-only, operator-only, or admin-only. Offer a deployment-mode switch if the user wants "local lab" openness but "installed venue" restrictions.

##### Why implement?
The current public docs/config/health combination is convenient for development but broad for a production box. The System and Dante tabs do not need every anonymous client to know the box's shape.

##### Why NOT implement (or defer)?
Public endpoints make smoke tests and simple health checks easier. If they are restricted, tests and monitoring need a clean replacement path.

##### Implementation notes
Move route protection decisions into a small explicit table rather than ad hoc assumptions. If `/api/v1/health` stays public, return a slimmer anonymous view and gate the detailed one behind auth.

---

#### Item 32 — Cross-entity name validation

**Importance:** 🟠 High  
**Impact:** Prevents malformed scenes, zones, buses, and sources from creating inconsistent UI and config state.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** BUG-02

##### What is it?
Generalise the scene-name rules into shared validation for zones, sources, buses, and any user-editable labels. Keep the rules simple and human-friendly.

##### Why implement?
Validation should not stop at scenes. The same class of issues can appear anywhere a user-provided label becomes a persisted identifier or a UI surface.

##### Why NOT implement (or defer)?
Global rules can be controversial if they are too strict. Make the validator shared, but keep the accepted character set broad.

##### Implementation notes
Add a small validation helper in the backend and reuse it across route modules. Mirror the same rules in the relevant modals and inline editors so the UX stays consistent.

---

#### Item 33 — WebSocket origin/trusted-host enforcement

**Importance:** 🟡 Medium  
**Impact:** Hardens the live control plane against accidental or hostile cross-origin use on the same LAN.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Validate the `Origin` or trusted host list during WebSocket upgrade and reject unexpected clients in production mode. Keep development mode permissive only when explicitly enabled.

##### Why implement?
The external research flagged WS origin handling as a real appliance concern. Minos uses WS heavily for state and metering, so this is worth tightening before staff-mode usage expands.

##### Why NOT implement (or defer)?
Origin handling on LAN appliances can be awkward if users access the box under several hostnames/IPs. The implementation needs a practical allowlist model.

##### Implementation notes
Add a trusted-host config option and check it in the upgrade path inside `crates/patchbox/src/api.rs`. Log rejections clearly so support can diagnose overly strict settings.

---

#### Item 34 — Export/import scopes that exclude users and secrets

**Importance:** 🟠 High  
**Impact:** Makes config sharing and migration safer by default.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** BUG-03

##### What is it?
Offer scoped exports/imports such as Routing/DSP only, Zones only, Scene library only, or Full admin package. Safe scopes should omit users, hashes, and other sensitive fields.

##### Why implement?
A lot of operational sharing is not "clone the entire appliance". Scoped packages are safer and map better to real support and deployment use cases.

##### Why NOT implement (or defer)?
Too many scopes can overwhelm users. Start with a small number of obvious choices instead of trying to package every possible subset.

##### Implementation notes
Model scopes explicitly in the backend and show them in the guided config workflow from Item 22. Reuse the same validation and diff machinery from Item 23.

---

## Reliability & Observability

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|
| 35 | Bulk-mutations API | 🟠 High | Medium | Medium | None |
| 36 | Persist-status banner for in-memory-only writes | 🟠 High | Easy | Low | None |
| 37 | WebSocket reconnect/resync UX | 🟠 High | Medium | Low | None |
| 38 | Background task status events | 🟡 Medium | Medium | Low | None |
| 39 | Prometheus/JSON metrics endpoint | 🟠 High | Medium | Low | None |

#### Item 35 — Bulk-mutations API

**Importance:** 🟠 High  
**Impact:** Turns several slow, chatty multi-call workflows into one atomic operation.  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Introduce a batched mutation endpoint for routes, gains, zone assignments, or partial scene applies. The backend should validate the whole request, then apply it as one logical change with one audit event.

##### Why implement?
This item already existed in the repo roadmap for good reason. It is the cleanest way to support safer scenes, better zone bulk operations, and future tablet workflows without a storm of tiny requests.

##### Why NOT implement (or defer)?
Batch APIs need careful validation and clear failure reporting. A vague "some of it failed" response is worse than the current single-step model.

##### Implementation notes
Build on the existing API organisation rather than creating one giant untyped payload. Use explicit mutation variants and reuse atomic-write helpers where possible.

---

#### Item 36 — Persist-status banner for in-memory-only writes

**Importance:** 🟠 High  
**Impact:** Makes persistence failures visible in the UI instead of looking like successful edits.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Whenever the backend reports a change is live only in memory, surface that state prominently and keep it visible until the issue is resolved or the user acknowledges it. Do not bury it in toast text only.

##### Why implement?
The API already exposes `in_memory: true` in error responses. The UI mostly treats failures as ephemeral notifications, which is not enough for a state that survives visually but will disappear on restart.

##### Why NOT implement (or defer)?
Too much alarm UI can become noisy. Restrict it to real persist failures, not ordinary validation errors.

##### Implementation notes
Centralise error handling in `web/src/js/api.js` or a thin wrapper so tabs do not each invent their own treatment. Add a shell-level banner that can include a "download diagnostics" shortcut once Item 27 exists.

---

#### Item 37 — WebSocket reconnect/resync UX

**Importance:** 🟠 High  
**Impact:** Makes live tabs recover gracefully instead of silently showing stale state after a transport problem.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Improve WS loss/reconnect behaviour with explicit stale-data state, reconnect reason, and active-tab rehydrate after reconnect. The UI should make it clear when controls are temporarily optimistic versus confirmed.

##### Why implement?
There is already an offline banner, but the target tabs still rely heavily on implicit WS health and periodic polling. Better reconnect semantics directly improve operator trust.

##### Why NOT implement (or defer)?
It touches shared frontend plumbing and can ripple into several tabs. Still, it is well worth it because the work is cross-cutting and highly visible.

##### Implementation notes
Enhance `web/src/js/ws.js` and `main.js` so reconnect triggers a targeted refresh of scenes/zones/system state and a user-visible banner. Avoid full-page reload unless the state model truly cannot be recovered.

---

#### Item 38 — Background task status events

**Importance:** 🟡 Medium  
**Impact:** Gives long-running operations a clear lifecycle instead of a spinner and hope.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Emit explicit task events for scene recall, config restore, engine restart, and rescan operations. The frontend should show queued/running/succeeded/failed states with enough detail to be actionable.

##### Why implement?
Several target-tab operations are asynchronous or disruptive, but the current UI often collapses them into a generic restart overlay or toast. Operators deserve a more truthful progress model.

##### Why NOT implement (or defer)?
If the backend does not really have task objects yet, this adds some scaffolding. Keep the first version lightweight and focused on the riskiest operations.

##### Implementation notes
Use the existing WS broadcast channel for task events. Define a small event schema like `{type:"task", id, kind, state, message}` and reuse it across System and Dante actions.

---

#### Item 39 — Prometheus/JSON metrics endpoint

**Importance:** 🟠 High  
**Impact:** Makes Minos observable from outside the web UI and improves supportability.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Expose Prometheus-friendly metrics plus a lightweight JSON summary for environments that do not run Prometheus. Include audio, WS, config-write, PTP, and scene/task metrics.

##### Why implement?
The repo roadmap and external research converge on this item. It gives the Dante and System tabs better data sources and gives operations something better than ad hoc SSH checks.

##### Why NOT implement (or defer)?
Metrics do not directly fix UX. If the team is focused only on visible tabs, this can look like back-office work even though it materially improves reliability.

##### Implementation notes
Start with a small, stable metric set: ws clients, config write duration, scene recall duration, audio drops/resyncs, PTP offset, DSP CPU. Feed the same values into the System/Dante cards to avoid duplicate health logic.

---

## Build, Testing & DX

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|---|---|---|---|---|---|
| 40 | Pin the Inferno git dependency | 🟠 High | Easy | Low | None |
| 41 | Pin Rust toolchain and reproducible build settings | 🟡 Medium | Easy | Low | None |
| 42 | Decouple mdbook/docs build from normal `cargo build` | 🟡 Medium | Medium | Low | None |
| 43 | Enforce Clippy/ESLint gates | 🟡 Medium | Medium | Low | None |
| 44 | Expand target-tab tests and retire stale frontend architecture | 🟠 High | Hard | Medium | None |

#### Item 40 — Pin the Inferno git dependency

**Importance:** 🟠 High  
**Impact:** Restores build reproducibility for the most critical external integration in the project.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Replace the floating `branch = "dev"` dependency in `patchbox-dante` with an explicit revision or vendored release. Make the intended upstream commit obvious and stable.

##### Why implement?
The build-hygiene audit identified this as the single sharpest reproducibility risk. The deployed appliance should not silently change because upstream `dev` moved.

##### Why NOT implement (or defer)?
If the team is actively co-developing against that branch every day, pinning can feel slower. Even then, it is better to update intentionally than to drift implicitly.

##### Implementation notes
Use `rev = "..."` in `crates/patchbox-dante/Cargo.toml` and document the upgrade procedure in the repo docs. Pair it with a short CI check that fails when `Cargo.lock` changes unexpectedly.

---

#### Item 41 — Pin Rust toolchain and reproducible build settings

**Importance:** 🟡 Medium  
**Impact:** Makes local builds, CI, and field rebuilds behave more consistently.  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add `rust-toolchain.toml` plus a small release-profile policy for reproducibility and smaller artifacts. Keep the settings boring and well documented.

##### Why implement?
The CI/build audit showed the project leaning on "whatever stable is today". That is convenient until one toolchain bump changes warnings, codegen, or build behaviour mid-stream.

##### Why NOT implement (or defer)?
Toolchain pinning is operational hygiene, not feature work. If the current team is moving very quickly, they may prefer to pin only once the backlog settles.

##### Implementation notes
Pin the exact stable version used in CI and document how to bump it. Consider pairing this with clearer release-profile settings for strip/LTO/debug-info so binaries are predictable.

---

#### Item 42 — Decouple mdbook/docs build from normal `cargo build`

**Importance:** 🟡 Medium  
**Impact:** Speeds up the dev loop and removes one unnecessary coupling from ordinary backend/frontend work.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Stop rebuilding embedded docs on every normal compile unless docs are explicitly requested. Keep docs generation in CI and release packaging, but do not force it on every developer build.

##### Why implement?
The build audit showed `build.rs` doing more than it needs to for ordinary code iteration. That is especially painful in a project that already embeds frontend assets.

##### Why NOT implement (or defer)?
If embedded docs are considered part of every release artifact, some coupling is acceptable. Just avoid paying that cost on every local compile.

##### Implementation notes
Gate docs embedding behind a feature or release mode and keep `docs.yml` as the canonical docs build path. Make sure the runtime responds cleanly when docs are absent in dev mode.

---

#### Item 43 — Enforce Clippy/ESLint gates

**Importance:** 🟡 Medium  
**Impact:** Prevents the backlog from growing more technical debt while the UI is still moving quickly.  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Pay down the currently tolerated warnings, then make CI fail on new Rust lint and frontend lint regressions. Keep the bar realistic, but make it real.

##### Why implement?
The audit found lint jobs that effectively warn without blocking. That is understandable mid-build, but it stops paying off once the codebase has enough surface area to drift.

##### Why NOT implement (or defer)?
Strict gates too early can slow delivery if the warning backlog is still high. Clear the current debt first, then tighten.

##### Implementation notes
Track the remaining warning count in the roadmap and switch CI from warn-only to fail-on-warning once the baseline is clean. Keep frontend lint output visible instead of suppressed.

---

#### Item 44 — Expand target-tab tests and retire stale frontend architecture

**Importance:** 🟠 High  
**Impact:** Makes future work on Scenes/Zones/Dante/System much safer and reduces confusion about which frontend path is real.  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Add focused tests for the target tabs and remove or formally archive the stale `web/src/modules` path if it is no longer the active frontend. Reduce the chance that future work lands in the wrong architecture.

##### Why implement?
The codebase structure still shows old and new frontend patterns living side by side, while test coverage on the target tabs is relatively shallow. That is a long-term drag on correctness and contributor confidence.

##### Why NOT implement (or defer)?
This is not a visible product feature, and it will touch a lot of files. It is best scheduled as a deliberate cleanup slice rather than as a side quest during urgent UI work.

##### Implementation notes
Add Playwright/API tests that specifically cover scene diff/recall, zone CRUD, Dante diagnostics rendering, and System backup/validate flows. Once the active frontend path is clear, delete or quarantine stale code to stop it confusing future sessions.
