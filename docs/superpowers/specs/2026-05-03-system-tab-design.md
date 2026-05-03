# System Tab Improvements — Design Spec

## Overview

Fixes five bugs/issues and one feature addition in the System tab of the Minos web UI.

---

## 1. PTP Status Display Fix

**Problem:** PTP shows "-" even when locked and passing audio. The `ptp_locked`, `ptp_offset_ns`, and `ptp_state` values from `/api/v1/system` are not being rendered correctly.

**Fix:** Ensure `renderPtpStatus()` correctly reads from `sys.ptp_locked`, `sys.ptp_offset_ns`, `sys.ptp_state`.

**Clock/PTP card enrichment — add three fields:**

| Field | Source | Display |
|-------|--------|---------|
| PTP Domain | `sys.ptp_domain` (or from PTP state) | `LOCKED (domain N)` or `—` |
| GM Identity | `sys.ptp_gm_identity` (if exposed) | Human-readable clock identity |
| Clock Source | `sys.clock_source` | `Dante Primary` / `Dante Secondary` |

If any field is unavailable, omit the row rather than showing "-".

---

## 2. Monitor Device Select Clipping Fix

**Problem:** `<select>` dropdown options render outside the card boundary.

**Fix:** Constrain select to card width.

CSS changes to `.cfg-select`:
- Add `width: 100%`
- Add `box-sizing: border-box`
- Remove or override any `flex: 1` that causes overflow

The card uses `overflow: visible` (default), so the dropdown will render outside the card visually but be width-constrained to it.

---

## 3. Remove "Show in Mixer" Toggle

**Change:** Remove the entire "Show in Mixer" row (`.sys-row` containing `#bus-show-toggle`) from the Internal Buses card.

Keep only:
- Bus Count input
- Apply (restart) button → moves to consolidated restart flow

---

## 4. Consolidated Restart Button

**Change:** Remove individual restart buttons from:
- Channel Configuration card (`#cfg-save-btn`)
- Internal Buses card (`#bus-count-btn`)

Add a new sticky or inline **Restart-Required Changes** section at the bottom of the `.sys-page` with:

| Element | Behavior |
|---------|----------|
| Pending count badge | Shows number of restart-required settings modified (e.g., `⚠ 2 changes pending`) |
| Warning label | "Changing these settings will restart the service and interrupt audio" |
| "Save & Restart" button | Primary action, disabled when no pending changes |
| "Discard Changes" button | Resets all pending inputs to live values, disabled when no pending changes |

**Per-card modified indicator:** Any restart-required input (RX, TX, bus count, Dante name) that differs from live config shows a small orange dot (●) in the card row, next to the label. Implemented via a CSS class `is-modified` on the `.sys-row`.

**Pending tracking:** Module-level state object tracks original live values. On each input change, compare against original. Update badge count reactively.

---

## 5. Dante Name Editable

**Location:** System Info card, alongside Hostname.

**UI:**
```
┌─ System ─────────────────────────────────────┐
│ Hostname        minos-01                      │
│ Dante Name      [minos-dante            ] ●  │
│ Version         1.2.3                         │
│ Uptime          4h 32m                       │
│ Sample Rate     48.0 kHz                     │
│ Channels        8 RX / 6 TX                  │
└──────────────────────────────────────────────┘
```

- **Hostname** — read-only plain text, no change
- **Dante Name** — `<input type="text">` styled as `.cfg-input`, max 63 chars (Dante spec)
- When value differs from live config, show `(requires restart)` suffix and orange dot (●)
- Included in consolidated restart flow
- On save: `putSystem({ dante_name: newValue })`

---

## 6. PTP Card Enrichment (data additions)

**Additional rows to add to Clock/PTP card if data available from API:**

| Row | Content |
|-----|---------|
| Domain | `domain N` from `sys.ptp_domain` |
| GM | Grandmaster clock identity string from `sys.ptp_gm_identity` |
| Source | `Dante Primary` / `Dante Secondary` from `sys.clock_source` |

Only show rows where data is non-null/non-empty.

---

## File Changes

| File | Changes |
|------|---------|
| `web/src/js/system.js` | PTP render fix, Dante name input, consolidated restart flow, remove bus-show toggle, pending state tracking |
| `web/src/css/system.css` | `.cfg-select` width constraint, `.is-modified` indicator style, new restart section styles |
| `web/src/js/api.js` | May need `putSystem({ dante_name })` — check existing `putSystem` already handles arbitrary keys |

---

## Test Checklist

- [ ] PTP LOCKED shows correctly in Clock/PTP card when `ptp_locked === true`
- [ ] PTP shows "—" with warn color when `ptp_locked === false`
- [ ] Monitor device dropdown options are constrained to card width
- [ ] "Show in Mixer" toggle row is absent from Internal Buses card
- [ ] Channel Config and Internal Buses have no individual restart buttons
- [ ] Dante name input appears in System Info card
- [ ] Dante name edit triggers pending changes indicator
- [ ] Consolidated restart section appears at bottom with correct pending count
- [ ] "Discard Changes" resets all modified inputs to live values
- [ ] "Save & Restart" calls correct API and shows restart overlay
- [ ] No regressions in other tabs
