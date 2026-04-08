# dante-patchbox — Web UI Improvement Roadmap (v2)

> **Document type:** Engineering review and improvement backlog — Web UI focused  
> **Scope:** `web-ui/` (index.html, app.js, style.css) + supporting Rust API surface  
> **Total items:** 64 (4 bug fixes + 60 improvements) — 54 resolved, 10 open  
> **Generated:** April 2026  
> **Basis:** Research branches A–F against deployed build (Sprint 12, commit `af74401`)  
> **Design skill:** Anthropic frontend-design skill (industrial/utilitarian aesthetic, amber accents, touch-first)
> **Last updated:** Sprints 13-21 complete (April 2026)

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
| Risk Low | Easy to revert, no runtime impact |
| Risk Medium | Could regress related areas |
| Risk High | Could break production |

---

## Resolved Items

| Sprint | Theme | Items |
|--------|-------|-------|
| **Sprint 13** | Bug fixes + security | BUG-W01, BUG-W02, BUG-W03, BUG-W04, W-41, W-43, W-44, W-47, W-52 |
| **Sprint 14** | Touch/mobile UX | W-04, W-05, W-16, W-17, W-18, W-21, W-22 |
| **Sprint 15** | Zones/views | W-10, W-11, W-13, W-15, W-24 |
| **Sprint 16** | Redesign + polish | W-02, W-03, W-09, W-55, W-56, W-59 |
| **Sprint 17** | Mixer UX completeness | W-07, W-08, W-12, W-14 |
| **Sprint 18** | Metering improvements | W-30, W-31, W-32, W-33, W-34, W-35 |
| **Sprint 19** | Zone overview + scheduling | W-23, W-25, W-26 |
| **Sprint 20** | Performance + PWA | W-45, W-46, W-49, W-50 |
| **Sprint 21** | Accessibility + polish | W-36, W-37, W-38, W-39, W-40, W-57, W-58 |

---

## Executive Summary

| ID | Category | Title | Importance | Difficulty | Risk | Prerequisites |
|----|----------|-------|------------|------------|------|---------------|
| BUG-W01 | Bug Fix | `showToast` undefined crash on WS connect | 🔴 Critical | Easy | Low | None |
| BUG-W02 | Bug Fix | XSS: channel labels not escaped in diff innerHTML | 🔴 Critical | Easy | Low | None |
| BUG-W03 | Bug Fix | Event listener memory leaks on buildUI() rebuild | 🟠 High | Medium | Low | None |
| BUG-W04 | Bug Fix | Binary WS frame not bounds-checked | 🟠 High | Easy | Low | None |
| W-16 | Mobile & Touch | 48 px minimum touch targets everywhere | 🔴 Critical | Medium | Low | None |
| W-41 | Security | Content Security Policy header in backend | 🔴 Critical | Easy | Low | None |
| W-42 | Security | Authenticate WebSocket upgrade with API key | 🔴 Critical | Medium | Medium | None |
| W-43 | Security | Escape HTML in all innerHTML paths | 🔴 Critical | Easy | Low | BUG-W02 |
| W-23 | Multi-Zone | Zone overview dashboard (all 7 bars) | 🟠 High | Hard | Medium | W-24 |
| W-24 | Multi-Zone | Zone selector tab / per-bar isolation | 🟠 High | Medium | Low | None |
| W-04 | Mixer UX | Colour-coded mute/solo with large touch targets | 🟠 High | Easy | Low | W-16 |
| W-05 | Mixer UX | "Clear all solos" global button | 🟠 High | Easy | Low | None |
| W-11 | Patchbay UX | Row/column highlight on tap (signal path) | 🟠 High | Easy | Low | None |
| W-12 | Patchbay UX | Bulk "Route to all zones" fan-out button | 🟠 High | Medium | Low | None |
| W-17 | Mobile & Touch | Fader lock (200 ms press-and-hold before drag) | 🟠 High | Easy | Low | None |
| W-18 | Mobile & Touch | Screen lock / kiosk mode (PIN to unlock) | 🟠 High | Medium | Low | None |
| W-22 | Mobile & Touch | Responsive tablet layout (portrait & landscape) | 🟠 High | Medium | Low | None |
| W-29 | Metering | Gain reduction meter on compressor strip | 🟠 High | Medium | Medium | None |
| W-30 | Metering | Clip latch indicator (stays lit until cleared) | 🟠 High | Easy | Low | None |
| W-45 | Performance | Incremental DOM updates (no full rebuild per tick) | 🟠 High | Hard | Medium | BUG-W03 |
| W-55 | Design | Full UI aesthetic redesign (industrial, amber) | 🟠 High | Hard | Low | W-16, W-04 |
| W-01 | Mixer UX | Vertical fader channel strips | 🟡 Medium | Hard | Medium | W-55 |
| W-02 | Mixer UX | Canonical channel strip order (gain→EQ→comp→fader) | 🟡 Medium | Medium | Low | None |
| W-03 | Mixer UX | Double-tap fader to reset to unity (0 dB) | 🟡 Medium | Easy | Low | None |
| W-06 | Mixer UX | Pan control per input channel | 🟡 Medium | Medium | Medium | W-01 |
| W-07 | Mixer UX | Phase invert button per input | 🟡 Medium | Easy | Low | None |
| W-08 | Mixer UX | Stereo link button for paired output channels | 🟡 Medium | Medium | Medium | None |
| W-09 | Mixer UX | Per-channel colour tag / scribble strip colour | 🟡 Medium | Easy | Low | W-55 |
| W-10 | Mixer UX | Channel view tabs ("Bar 1–3", "Stage", "All") | 🟡 Medium | Medium | Low | W-24 |
| W-13 | Patchbay UX | Signal flow axis direction labels | 🟡 Medium | Easy | Low | None |
| W-14 | Patchbay UX | Shift-drag bulk cell multi-select | 🟡 Medium | Medium | Low | None |
| W-15 | Patchbay UX | Matrix filter (show active routes only) | 🟡 Medium | Easy | Low | None |
| W-19 | Mobile & Touch | Multi-touch simultaneous fader (pointerId) | 🟡 Medium | Medium | Low | None |
| W-20 | Mobile & Touch | Pinch-to-zoom matrix + swipe navigation | 🟡 Medium | Hard | Medium | None |
| W-21 | Mobile & Touch | Haptic feedback via navigator.vibrate() | 🟡 Medium | Easy | Low | None |
| W-25 | Multi-Zone | Zone grouping with linked faders (chain-link) | 🟡 Medium | Hard | Medium | W-24 |
| W-26 | Multi-Zone | Time-based zone preset scheduler | 🟡 Medium | Hard | Medium | W-24, W-10 |
| W-27 | Multi-Zone | Per-zone source selector carousel | 🟡 Medium | Medium | Low | W-24 |
| W-28 | Multi-Zone | Zone isolation (bar staff see only their zone) | 🟡 Medium | Medium | Medium | W-24, W-42 |
| W-31 | Metering | Pre-cache canvas gradient (fix GC pressure) | 🟡 Medium | Easy | Low | None |
| W-32 | Metering | Peak-hold decay rate configurable in UI | 🟡 Medium | Easy | Low | None |
| W-33 | Metering | RMS meter bar alongside peak (dual bar) | 🟡 Medium | Medium | Low | W-31 |
| W-34 | Metering | Master bus stereo L/R meter | 🟡 Medium | Medium | Low | W-33 |
| W-35 | Metering | Signal presence pulse on active matrix cells | 🟡 Medium | Easy | Low | None |
| W-36 | Accessibility | Full ARIA on all custom sliders and buttons | 🟡 Medium | Medium | Low | None |
| W-37 | Accessibility | Complete keyboard navigation (Tab/arrows/M/S) | 🟡 Medium | Medium | Low | W-36 |
| W-38 | Accessibility | Focus trap in modals + ESC to close | 🟡 Medium | Easy | Low | None |
| W-39 | Accessibility | High-contrast CSS theme variant | 🟡 Medium | Easy | Low | W-56 |
| W-40 | Accessibility | prefers-color-scheme + light theme | 🟡 Medium | Medium | Low | W-56 |
| W-44 | Security | Binary WS message bounds checking | 🟡 Medium | Easy | Low | BUG-W04 |
| W-46 | Performance | Event listener cleanup on row removal | 🟡 Medium | Medium | Low | BUG-W03 |
| W-47 | Performance | Cache canvas offsetWidth outside rAF loop | 🟡 Medium | Easy | Low | None |
| W-48 | Performance | Virtual row rendering for matrices >12 inputs | 🟡 Medium | Hard | Medium | W-45 |
| W-49 | Performance | GPU-composited fader knob (transform, will-change) | 🟡 Medium | Easy | Low | W-01 |
| W-50 | Dev Experience | PWA manifest + service worker (Workbox) | 🟡 Medium | Medium | Low | None |
| W-51 | Dev Experience | Self-host Google Fonts (bundle into binary) | 🟡 Medium | Easy | Low | None |
| W-52 | Dev Experience | HTTP cache headers for static assets | 🟡 Medium | Easy | Low | None |
| W-53 | Dev Experience | Dev-mode hot reload (fs-watcher) | 🟡 Medium | Medium | Low | None |
| W-56 | Design | Dark/light theme toggle with localStorage | 🟡 Medium | Easy | Low | W-55 |
| W-57 | Design | Scene thumbnail / state preview card | 🟡 Medium | Medium | Low | None |
| W-58 | Design | Onboarding overlay (first-run tour) | 🟢 Low | Medium | Low | W-55 |
| W-59 | Design | Toast stack (multiple simultaneous, click dismiss) | 🟢 Low | Easy | Low | BUG-W01 |
| W-60 | Design | Animated signal flow lines on active cells | 🟢 Low | Medium | Low | W-55 |

---

## Where to Start

### Top 5 Quick Wins (Easy + Critical/High)

1. **BUG-W01** — Fix `showToast` undefined: 5-minute fix, eliminates crash on WS connect
2. **BUG-W02 / W-43** — Escape channel labels in diff innerHTML: 10-minute XSS fix
3. **W-41** — Add CSP header in Rust backend: 30-minute one-liner in `api/mod.rs`
4. **W-30** — Clip latch indicator: small canvas addition, high operator value
5. **W-05** — "Clear all solos" button: one button, one API call, essential during sound check

### Top 5 High-Impact Items (regardless of difficulty)

1. **W-55** — Full UI redesign: transforms usability and visual identity of the product
2. **W-16** — 48 px touch targets: makes the app usable on tablets without a stylus
3. **W-24** — Zone selector: the foundational feature for multi-bar pub deployment
4. **W-42** — WebSocket auth: closes the unauthenticated control surface security hole
5. **W-45** — Incremental DOM updates: eliminates the main source of UI jank at 60 fps

### Recommended Sprint Sequencing

| Sprint | Theme | Items |
|--------|-------|-------|
| **Sprint 13** | Bug fixes + security baseline | BUG-W01, BUG-W02, BUG-W03, BUG-W04, W-41, W-43, W-44, W-47, W-52 |
| **Sprint 14** | Touch & tablet foundation | W-16, W-04, W-05, W-17, W-18, W-21, W-22 |
| **Sprint 15** | Zone management | W-24, W-27, W-28, W-10, W-13, W-15 |
| **Sprint 16** | Full UI redesign (frontend-design skill) | W-55, W-56, W-09, W-59, W-02, W-03 |
| **Sprint 17** | Mixer UX completeness | W-01, W-06, W-07, W-08, W-11, W-12, W-14 |
| **Sprint 18** | Metering improvements | W-29, W-30, W-31, W-32, W-33, W-34, W-35 |
| **Sprint 19** | Zone grouping + scheduling | W-23, W-25, W-26 |
| **Sprint 20** | Performance + PWA | W-45, W-46, W-48, W-49, W-50, W-51, W-53 |
| **Sprint 21** | Accessibility + polish | W-36, W-37, W-38, W-39, W-40, W-57, W-58, W-60 |

---

## Dependency Map

```
BUG-W01  → (none)           ← foundation
BUG-W02  → (none)           ← foundation
BUG-W03  → (none)           ← foundation
BUG-W04  → (none)           ← foundation

W-43     → BUG-W02
W-44     → BUG-W04
W-45     → BUG-W03
W-46     → BUG-W03

W-04     → W-16
W-10     → W-24
W-23     → W-24
W-25     → W-24
W-26     → W-24, W-10
W-27     → W-24
W-28     → W-24, W-42

W-01     → W-55
W-06     → W-01
W-49     → W-01

W-33     → W-31
W-34     → W-33

W-37     → W-36
W-39     → W-56
W-40     → W-56
W-48     → W-45
W-56     → W-55
W-58     → W-55
W-60     → W-55
```

**Foundation items (no prerequisites):** BUG-W01, BUG-W02, BUG-W03, BUG-W04, W-05, W-07, W-11, W-13, W-15, W-17, W-18, W-21, W-22, W-24, W-30, W-31, W-36, W-38, W-41, W-42, W-47, W-50, W-51, W-52, W-53

---

## Bug Fixes

### Summary Table

| ID | Title | Importance | Difficulty | Risk |
|----|-------|------------|------------|------|
| BUG-W01 | `showToast` undefined crash on WS connect | 🔴 Critical | Easy | Low |
| BUG-W02 | XSS: channel labels not escaped in diff innerHTML | 🔴 Critical | Easy | Low |
| BUG-W03 | Event listener memory leaks on buildUI() rebuild | 🟠 High | Medium | Low |
| BUG-W04 | Binary WS frame not bounds-checked | 🟠 High | Easy | Low |

---

#### BUG-W01 — `showToast` undefined crash on WebSocket connect

**Importance:** 🔴 Critical  
**Impact:** Eliminates a guaranteed ReferenceError thrown on every WS connection open  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`app.js:669` calls `showToast('Connected', 1500)` but only `toast(msg, type)` is defined at line 50. The function name mismatch causes `ReferenceError: showToast is not defined` every time the WebSocket connects or reconnects. This error is swallowed by the onerror handler but the connection toast never appears.

##### Why implement?
The app silently fails to inform operators that the live connection is established. A missing "Connected" notification can make bar staff think the app is not working. One-word rename fix.

##### Why NOT implement (or defer)?
No valid reason to defer. Pure rename.

##### Implementation notes
```js
// app.js:669 — change:
showToast('Connected', 1500);
// to:
toast('Connected', 'ok');
```

---

#### BUG-W02 — XSS: channel labels not escaped in scene diff innerHTML

**Importance:** 🔴 Critical  
**Impact:** Prevents a stored XSS attack via a crafted Dante channel name  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`app.js:860–867` builds the scene diff display body using `innerHTML` string interpolation that includes `d.label` (the channel name from API state). If a channel is named `<img src=x onerror=alert(1)>`, the browser executes it. The backend enforces 64-char max but does not HTML-sanitize. `escHtml()` is already defined in the file and used for scene names — just not here.

##### Why implement?
A compromised Dante device or spoofed mDNS advertisement could inject a malicious channel name visible to all connected operators. Trivial one-line fix using the existing `escHtml()` function.

##### Why NOT implement (or defer)?
The threat is low in a private LAN-only deployment but the fix is trivial, so there is no reason to defer.

##### Implementation notes
```js
// app.js ~line 858-867 — wrap all d.label, d.prev, d.next with escHtml():
body.innerHTML = diffs.map(d =>
  `<div class="diff-row">
    <span class="diff-label">${escHtml(d.label)}</span>
    <span class="diff-prev">${escHtml(d.prev)}</span>
    <span class="diff-arrow">→</span>
    <span class="diff-next">${escHtml(d.next)}</span>
  </div>`
).join('');
```

---

#### BUG-W03 — Event listener memory leaks on buildUI() rebuild

**Importance:** 🟠 High  
**Impact:** Eliminates unbounded memory growth; prevents duplicate handler firing on long-running sessions  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`buildUI()` calls `elOutputLabels.innerHTML = ''` and `elMatrixRows.innerHTML = ''` to clear the DOM, then rebuilds all rows and cells. But the old event listeners (click, contextmenu, drag, input, etc.) are never explicitly removed — they accumulate each rebuild. Over an 8-hour bar session with frequent state syncs, this causes unbounded memory growth and multiple handlers firing per click.

##### Why implement?
On a pub tablet left running all day, the session can accumulate thousands of orphaned listeners. This causes clicks to fire N times and eventual tab OOM on entry-level Android devices.

##### Why NOT implement (or defer)?
Can be deferred short-term by wrapping handlers with `{ once: true }` for click-like events, but the proper fix is scoped row/cell elements with `AbortController`-based cleanup.

##### Implementation notes
```js
// Pattern: use AbortController per row
function buildInputRow(i, rank) {
  const ac = new AbortController();
  const { signal } = ac;
  row.dataset.acKey = i;
  rowControllers.set(i, ac);
  
  muteBtn.addEventListener('click', () => toggleInputMute(i), { signal });
  soloBtn.addEventListener('click', () => toggleInputSolo(i), { signal });
  // ...
}

// Before rebuild:
function buildUI() {
  rowControllers.forEach(ac => ac.abort());
  rowControllers.clear();
  elMatrixRows.innerHTML = '';
  // ...rebuild
}

const rowControllers = new Map();
```

---

#### BUG-W04 — Binary WebSocket frame not bounds-checked

**Importance:** 🟠 High  
**Impact:** Prevents OOB array reads if backend sends malformed meter frame  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`app.js` parses binary WS frames as `Float32Array` and indexes into them assuming exactly `nInputs + nOutputs` floats. If the backend sends a frame with fewer values (e.g. after a channel count change mid-session), the code reads `undefined` into meter state silently, causing NaN display values and potential canvas corruption.

##### Why implement?
Defensive coding for production audio hardware. A firmware update that changes the channel count mid-session without a page reload would cause persistent NaN meters.

##### Why NOT implement (or defer)?
Very low probability event in stable deployments. Acceptable to defer until after Sprint 13 if time is tight.

##### Implementation notes
```js
// app.js in onmessage binary handler:
const floats = new Float32Array(ev.data);
const expected = state.nInputs + state.nOutputs;
if (floats.length < expected) {
  console.warn(`WS meter frame too short: got ${floats.length}, want ${expected}`);
  return;
}
```

---

## Mixer UX

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-01 | Vertical fader channel strips | 🟡 Medium | Hard | Medium | W-55 |
| W-02 | Canonical channel strip ordering | 🟡 Medium | Medium | Low | None |
| W-03 | Double-tap fader to reset to unity | 🟡 Medium | Easy | Low | None |
| W-04 | Colour-coded mute/solo (44 px) | 🟠 High | Easy | Low | W-16 |
| W-05 | "Clear all solos" global button | 🟠 High | Easy | Low | None |
| W-06 | Pan control per input channel | 🟡 Medium | Medium | Medium | W-01 |
| W-07 | Phase invert button per input | 🟡 Medium | Easy | Low | None |
| W-08 | Stereo link for output pairs | 🟡 Medium | Medium | Medium | None |
| W-09 | Per-channel colour tag (scribble strip) | 🟡 Medium | Easy | Low | W-55 |
| W-10 | Channel view tabs | 🟡 Medium | Medium | Low | W-24 |

---

#### W-01 — Vertical fader channel strips

**Importance:** 🟡 Medium  
**Impact:** Provides familiar mixing console muscle memory; enables fast level setting by sight  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** W-55 (UI redesign must establish the layout grid first)

##### What is it?
Replace the current horizontal `<input type="range">` gain sliders with tall vertical faders rendered as custom elements. Each strip has a fader track, a draggable knob, dB scale markings (−∞, −20, −10, −6, −3, 0 dBu), and a digital readout above the knob. The fader knob should be at least 48 px wide for reliable touch operation.

##### Why implement?
Trained sound operators expect vertical faders. The current horizontal sliders require horizontal swipe gestures that conflict with page scroll. Vertical faders also give much higher precision for small gain adjustments.

##### Why NOT implement (or defer)?
Hard to implement well as pure CSS. A canvas or SVG fader has a significant maintenance cost. Defer until the UI redesign (W-55) establishes the grid.

##### Implementation notes
```js
// Custom fader component using pointer events:
faderTrack.addEventListener('pointerdown', onFaderStart);
document.addEventListener('pointermove', onFaderDrag, { passive: false });
document.addEventListener('pointerup', onFaderEnd);

function onFaderDrag(e) {
  e.preventDefault();
  const pct = clamp((trackRect.bottom - e.clientY) / trackRect.height, 0, 1);
  const db = percentToDb(pct); // −60..+6 dB range
  updateFader(channelIdx, db);
}

// CSS — the knob only:
.fader-knob { 
  transform: translateY(calc((1 - pct) * trackHeight - knobHeight/2));
  will-change: transform; /* GPU compositor track */
}
```
dB scale: use a non-linear taper (logarithmic between −60 and 0, then linear 0 to +6).

---

#### W-02 — Canonical channel strip ordering

**Importance:** 🟡 Medium  
**Impact:** Reduces operator errors by matching hardware console muscle memory  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Reorder the input strip DOM so controls flow top-to-bottom: channel name → Dante activity dot → gain trim → EQ button → phase invert → mute → solo → fader → routing cells. This mirrors the signal chain and standard hardware console layout (SSL, Neve, Allen & Heath all follow this order).

##### Why implement?
Currently: name → dot → mute → solo → trim → EQ. This is not signal-chain order. Trained operators reach for trim where the fader should be.

##### Why NOT implement (or defer)?
Pure cosmetic reorder, but may break CSS that assumes current order. Low risk if done as part of the redesign sprint.

##### Implementation notes
Change the DOM build order in `buildInputRow()` in `app.js`. No API changes needed. Update corresponding `.input-strip` CSS flex/grid order.

---

#### W-03 — Double-tap fader to reset to unity (0 dB)

**Importance:** 🟡 Medium  
**Impact:** Speeds up sound check reset; prevents "where did the level go?" confusion  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a double-click / double-tap handler on each fader element that resets the gain to 0 dB (unity, linear value 1.0). Show a brief "0 dB" toast.

##### Why implement?
Universal hardware convention on all mixing consoles. Saves operators time during sound checks when they need to quickly restore a channel to nominal level.

##### Why NOT implement (or defer)?
No valid reason — it's an easy add and sets a professional-grade UX expectation.

##### Implementation notes
```js
// Detect double-tap via timing:
let lastTap = 0;
faderEl.addEventListener('click', (e) => {
  const now = Date.now();
  if (now - lastTap < 350) {
    sendInputGainTrim(i, 1.0); // unity
    applyGainTrim(i, 1.0);
    toast('Unity', 'ok');
  }
  lastTap = now;
});
```

---

#### W-04 — Colour-coded mute/solo with 44 px touch targets

**Importance:** 🟠 High  
**Impact:** Makes mute/solo reliable on tablets; colour coding prevents mis-presses  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** W-16 (touch target audit)

##### What is it?
Enlarge mute and solo buttons from 18 × 18 px to minimum 44 × 44 px. Apply colour coding: mute = amber (`#f59e0b`), solo = yellow (`#eab308`), both active = distinctive orange-red. Add a visual "both active" combined state colour. Use `aria-pressed` on both buttons.

##### Why implement?
Current 18 px buttons require stylus-level precision. On a busy bar top with wet fingers, operators constantly miss. The colour coding is the industry standard (Pro Tools, Logic, every hardware console uses amber for mute).

##### Why NOT implement (or defer)?
No reason to defer — this is one CSS change and one DOM size attribute change.

##### Implementation notes
```css
.btn-mute { min-width: 44px; min-height: 44px; background: var(--mute-off); }
.btn-mute.active { background: #f59e0b; color: #000; }
.btn-solo { min-width: 44px; min-height: 44px; background: var(--solo-off); }
.btn-solo.active { background: #eab308; color: #000; }
```

---

#### W-05 — "Clear all solos" global button

**Importance:** 🟠 High  
**Impact:** Prevents sound system going silent when multiple solos are left active  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a "CLEAR SOLOS" button to the header bar that calls POST `/channels/input/all/solo/clear` (or loops through all inputs in JS if no backend endpoint exists). The button only appears when at least one solo is active (visual indicator). Flash in yellow while any solo is active.

##### Why implement?
During sound check, operators often leave multiple solos engaged. When the event starts, all un-soloed channels are silenced. A clearly visible "clear all solos" button prevents this common mistake.

##### Why NOT implement (or defer)?
No reason to defer — one button, one API loop, high safety value.

##### Implementation notes
```js
async function clearAllSolos() {
  const promises = state.inputs
    .filter((inp, i) => inp.solo)
    .map((_, i) => apiFetch(`/channels/input/${i}/solo`, 'POST', { solo: false }));
  await Promise.all(promises);
  state.inputs.forEach(inp => inp.solo = false);
  buildUI();
}
```
Add a `GET /api/v1/channels/input/solo/clear` endpoint on the backend or simply iterate in JS.

---

#### W-06 — Pan control per input channel

**Importance:** 🟡 Medium  
**Impact:** Enables stereo placement of sources in left/right speaker zones  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** W-01 (requires vertical strip layout)

##### What is it?
Add a small pan knob (or horizontal mini-slider) per input channel, sending a −1.0 to +1.0 pan value to the backend. The backend applies it as a gain differential across L/R output pairs. Requires a backend `pan` field on `InputChannel` and a pan processing step.

##### Why implement?
Without panning, all sources are centred. A live band with separate instruments on separate Dante channels cannot be placed in the stereo image. Essential for any production use.

##### Why NOT implement (or defer)?
Requires backend DSP changes (not just UI). Defer to Sprint 17 when the vertical strip layout is in place and backend pan support is added.

##### Implementation notes
Implement as a small horizontal range slider (-1 to +1, center click = 0). Display L30/C/R30 markers. Backend: add `pan: f32` to `InputChannel`, apply in the matrix multiplication: `left_gain = gain * max(0.0, 1.0 - pan)`, `right_gain = gain * max(0.0, 1.0 + pan)`.

---

#### W-07 — Phase invert button per input

**Importance:** 🟡 Medium  
**Impact:** Fixes comb filtering when two microphones on same source are out of phase  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a `Ø` (phi) button per input channel that posts a `phase_invert: bool` to the backend. The backend multiplies all samples on that channel by −1 before mixing. The button glows red when active as a caution indicator.

##### Why implement?
Phase inversion is essential for live sound. Two directional mics on a snare drum, or a DI box with incorrect polarity, will cancel. The fix is a single button press — without it operators must fix cabling.

##### Why NOT implement (or defer)?
Requires small backend DSP addition. Straightforward but not urgent for a pub background music system. Defer to Sprint 17.

##### Implementation notes
Backend: add `phase_invert: bool` to `InputChannel`. In audio path: `sample = if phase_invert { -sample } else { sample }`. Frontend: `Ø` button with red active state, `aria-pressed`, POST `/channels/input/{i}/phase`.

---

#### W-08 — Stereo link for output channel pairs

**Importance:** 🟡 Medium  
**Impact:** Enables true stereo zone control (L/R pair moves together)  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Add a chain-link button between adjacent output channels that links their faders. When linked, moving one fader moves the other by the same amount (gang mode). Store link state in frontend JS, no backend change needed for the fader coupling.

##### Why implement?
In a pub, each bar zone likely uses a stereo pair (L/R speakers). Without stereo link, operators must move two faders for every level change — doubling the work and risking L/R imbalance.

##### Why NOT implement (or defer)?
Link state is client-side only in the simple case (both outputs get the same gain). If multiple tablets are connected, link state must be shared via backend. Defer backend sync to a later sprint; implement client-side link first.

##### Implementation notes
```js
const linkedPairs = new Set(); // stores pairs as "o1:o2" strings

function sendOutputMasterGainLinked(o, gain) {
  sendOutputMasterGain(o, gain);
  const partner = getLinkedPartner(o);
  if (partner !== null) sendOutputMasterGain(partner, gain);
}
```

---

#### W-09 — Per-channel colour tag / scribble strip colour

**Importance:** 🟡 Medium  
**Impact:** Speeds up channel identification in a busy 7-bar routing matrix  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** W-55 (redesign establishes the colour system)

##### What is it?
Each input and output channel strip gets a colour swatch (palette: 8 colours). Clicking the swatch cycles through colours. The chosen colour is stored in `localStorage` keyed by channel name. The colour tints the strip header and the corresponding meter row.

##### Why implement?
Professional hardware consoles (Yamaha CL, Soundcraft Vi) use colour-coded scribble strips. With 7 bar zones and multiple inputs, visual colour coding dramatically reduces patching errors.

##### Why NOT implement (or defer)?
localStorage means colour assignments are per-browser, not shared across tablets. For shared state, this needs a backend config field. Acceptable to start with localStorage.

##### Implementation notes
```js
const STRIP_COLOURS = ['#dc2626','#ea580c','#ca8a04','#16a34a','#0284c7','#7c3aed','#db2777','#6b7280'];
function cycleStripColour(type, id) {
  const key = `strip-colour-${type}-${id}`;
  const cur = STRIP_COLOURS.indexOf(localStorage.getItem(key));
  const next = STRIP_COLOURS[(cur + 1) % STRIP_COLOURS.length];
  localStorage.setItem(key, next);
  applyStripColour(type, id, next);
}
```

---

#### W-10 — Channel view tabs ("Bar 1–3", "Stage", "All")

**Importance:** 🟡 Medium  
**Impact:** Lets operators focus on their zone without horizontal scrolling across 16+ channels  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** W-24 (zone selector)

##### What is it?
Add a tab bar above the matrix (or in the header) with named views. Each view is a saved list of input/output channel indices to display. Tabs are user-definable. "All" always shows everything. Switching a tab filters `state.inputOrder` and `state.outputOrder` to show only the relevant channels.

##### Why implement?
On a 7" tablet with 8 inputs × 7 outputs = 56 cells, the matrix is hard to read. A "Bar 2" tab showing only 2 inputs × 1 output is immediately actionable for bar staff.

##### Why NOT implement (or defer)?
View definitions should eventually be stored in the backend so all tablets share the same views. Start with localStorage storage.

##### Implementation notes
Views stored as `{ name: string, inputs: number[], outputs: number[] }[]`. Render as tabs in the header. Switching tab: filter `state.inputOrder` / `state.outputOrder`, call `buildUI()`.

---

## Patchbay UX

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-11 | Row/column highlight on tap | 🟠 High | Easy | Low | None |
| W-12 | Bulk "Route to all zones" fan-out | 🟠 High | Medium | Low | None |
| W-13 | Signal flow axis direction labels | 🟡 Medium | Easy | Low | None |
| W-14 | Shift-drag bulk cell multi-select | 🟡 Medium | Medium | Low | None |
| W-15 | Matrix filter (show active routes only) | 🟡 Medium | Easy | Low | None |

---

#### W-11 — Row/column highlight on tap (signal path inspection)

**Importance:** 🟠 High  
**Impact:** Makes routing verification instant; eliminates tracing with a finger across the matrix  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
When the user taps or clicks a matrix cell, highlight the entire row (input) and entire column (output) with a subtle tint. Hold a `.row-highlight` and `.col-highlight` CSS class on the corresponding header and cells. Clear on tap elsewhere.

##### Why implement?
In a 16 × 8 matrix, tracing whether a source is routed to a destination requires scanning across the grid. A tap highlight makes it instant — critical during a live event.

##### Why NOT implement (or defer)?
No reason to defer — it is a pure CSS class addition with trivial JS.

##### Implementation notes
```js
function highlightPath(row, col) {
  document.querySelectorAll('.row-hi,.col-hi').forEach(el => el.classList.remove('row-hi','col-hi'));
  document.querySelectorAll(`.cell-r${row}`).forEach(el => el.classList.add('row-hi'));
  document.querySelectorAll(`.cell-c${col}`).forEach(el => el.classList.add('col-hi'));
}
```
CSS: `.row-hi { background: rgba(255,160,0,0.08); }` `.col-hi { background: rgba(255,160,0,0.08); }`

---

#### W-12 — Bulk "Route to all zones" fan-out button

**Importance:** 🟠 High  
**Impact:** Routes a source to all outputs in 1 tap instead of 7 taps  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a "fan out" button on each input strip row (icon: one-to-many arrows) that routes that input to ALL currently visible outputs in one tap. With confirmation toast: "Routed [Input Name] to all zones". Also add a "disconnect all" button (one-to-none) for fast cleanup.

##### Why implement?
The most common pub operation: background music source → all bar zones. Currently requires 7 individual cell taps. A single fan-out button cuts this to one tap with confirmation.

##### Why NOT implement (or defer)?
Should respect the active view filter (W-10) — only route to visible outputs. Requires W-10 for full value; implement standalone version first.

##### Implementation notes
```js
async function routeInputToAllOutputs(i) {
  const visible = state.outputOrder;
  const patches = visible.map(o => apiFetch(`/matrix/${i}/${o}`, 'PATCH', { gain: 1.0 }));
  await Promise.all(patches);
  visible.forEach(o => applyGain(i, o, 1.0));
  toast(`${state.inputs[i].label} → all zones`);
}
```

---

#### W-13 — Signal flow axis direction labels

**Importance:** 🟡 Medium  
**Impact:** Eliminates "which axis is sources" confusion for first-time operators  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add clear axis labels to the matrix grid: a rotated "SOURCES →" label on the left spine (above the input strips) and a "DESTINATIONS ↓" label on the top row (above the output headers). Use small, muted text so it doesn't clutter the layout but is visible when needed.

##### Why implement?
Every new bar staff member has to be taught which axis is which. Clear labelling removes this onboarding friction with zero implementation cost.

##### Why NOT implement (or defer)?
No reason to defer.

##### Implementation notes
Add to the corner cell `.corner-cell`: `<span class="axis-src">SOURCES</span><span class="axis-dst">DESTINATIONS</span>`. Style with small rotated text.

---

#### W-14 — Shift-drag bulk cell multi-select

**Importance:** 🟡 Medium  
**Impact:** Enables routing one source to a contiguous range of outputs in a single drag gesture  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
When the user holds Shift and drags across cells, each cell the pointer crosses is toggled to "on". On touch, a two-finger horizontal drag activates bulk-select mode. This is how broadcast router panels (Evertz, Grass Valley) work.

##### Why implement?
For initial system setup where many patches need to be created, individual cell taps are slow. A shift-drag across a row creates all patches for one source at once.

##### Why NOT implement (or defer)?
Relatively complex pointer tracking but entirely client-side. Defer to Sprint 17.

##### Implementation notes
Track `mousedown` on first cell → `mousemove` on subsequent cells with Shift held → set all to the same state as the first cell. Use `data-selecting` attribute on the container to prevent accidental activations.

---

#### W-15 — Matrix filter (show active routes only)

**Importance:** 🟡 Medium  
**Impact:** Reduces matrix visual noise; shows only active signal paths at a glance  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
A toggle button in the header: "ACTIVE ONLY". When enabled, rows (inputs) with no active cells are hidden, and columns (outputs) with no active cells are hidden. Shows only the currently active routing topology.

##### Why implement?
In a 16 × 8 matrix with only 7 routes active, 96% of cells are empty. The filter reveals the routing map instantly — useful for verification before a show starts.

##### Why NOT implement (or defer)?
No reason to defer — simple CSS `display:none` filter on rows/columns.

##### Implementation notes
```js
function applyActiveFilter(enabled) {
  state.inputOrder.forEach(i => {
    const hasRoute = state.outputOrder.some(o => state.matrix[i][o] > 0);
    document.querySelector(`[data-row="${i}"]`).style.display = (!enabled || hasRoute) ? '' : 'none';
  });
}
```

---

## Mobile & Touch

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-16 | 48 px minimum touch targets | 🔴 Critical | Medium | Low | None |
| W-17 | Fader lock (200 ms press-and-hold) | 🟠 High | Easy | Low | None |
| W-18 | Screen lock / kiosk mode | 🟠 High | Medium | Low | None |
| W-19 | Multi-touch simultaneous faders | 🟡 Medium | Medium | Low | None |
| W-20 | Pinch-to-zoom matrix + swipe nav | 🟡 Medium | Hard | Medium | None |
| W-21 | Haptic feedback (navigator.vibrate) | 🟡 Medium | Easy | Low | None |
| W-22 | Responsive tablet layout (portrait/landscape) | 🟠 High | Medium | Low | None |

---

#### W-16 — 48 px minimum touch targets everywhere

**Importance:** 🔴 Critical  
**Impact:** Makes the app usable on 7" tablets without a stylus; eliminates miss-taps  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Audit and enlarge every interactive element to meet the WCAG 2.5.5 / Apple HIG / Material Design minimum of 44–48 px in both dimensions. Currently: mute/solo buttons are 18 × 18 px, matrix cells are 40 × 40 px, EQ/compressor buttons are 18 × 18 px. Everything must become at minimum 44 × 44 px.

##### Why implement?
Bar staff use the tablets with wet hands, in dim lighting, under time pressure. 18 px buttons are not reliably tappable. This is the single most impactful change for the pub deployment scenario.

##### Why NOT implement (or defer)?
Enlarging buttons changes the layout density. The matrix may require horizontal scrolling at high channel counts. Acceptable trade-off — the app must be touchable first.

##### Implementation notes
```css
/* Apply globally */
button, .btn-icon, .matrix-cell, input[type="range"] {
  min-height: 44px;
  min-width: 44px;
}

/* For cells that must remain smaller visually, use ::before padding trick */
.matrix-cell::before {
  content: '';
  position: absolute;
  inset: -4px; /* expands tap area without changing layout */
}
```
Also set `--cell-size: 48px` and `--strip-w: 140px` in CSS variables.

---

#### W-17 — Fader lock (200 ms press-and-hold before drag)

**Importance:** 🟠 High  
**Impact:** Prevents accidental level changes when scrolling near faders  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Require a 200 ms `pointerdown` hold before the fader begins to respond to drag. Add a brief visual pulse on the fader knob when the lock disengages (e.g. scale-up animation). On Android Chrome, add `navigator.vibrate([10])` haptic confirmation.

##### Why implement?
A common complaint with tablet mixing apps: accidentally sweeping a fader while scrolling to see other channels. The hold-to-activate pattern is used in all tablet DAW control surfaces (TouchOSC, Lemur).

##### Why NOT implement (or defer)?
Adds a tiny latency to intentional fader moves. Use a short 150–200 ms threshold; trained operators adapt quickly.

##### Implementation notes
```js
let faderLockTimer = null;
faderEl.addEventListener('pointerdown', (e) => {
  faderLockTimer = setTimeout(() => {
    faderEl.setPointerCapture(e.pointerId);
    navigator.vibrate?.([10]);
    faderEl.classList.add('unlocked');
    startFaderDrag(e);
  }, 200);
});
faderEl.addEventListener('pointerup', () => { clearTimeout(faderLockTimer); faderEl.classList.remove('unlocked'); });
```

---

#### W-18 — Screen lock / kiosk mode

**Importance:** 🟠 High  
**Impact:** Prevents patrons or cleaning staff from accidentally changing levels on unattended tablets  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
A padlock icon button in the header. When tapped, a full-screen overlay dims the UI and disables all interactive controls. Unlocking requires either a tap-pattern (3 corners in sequence) or a 4-digit PIN stored in localStorage. Show the current zone name and master levels on the lock screen as a status display.

##### Why implement?
Tablets on bar tops are public-facing. Without a lock mechanism, patrons, delivery staff, or cleaning crew can accidentally (or intentionally) change the sound system. This is a production-critical feature for the pub deployment.

##### Why NOT implement (or defer)?
PIN auth is client-side only in this implementation — a determined person can reload the page. Stronger lock requires backend auth integration (W-28). Client-side lock is sufficient for accidental interaction.

##### Implementation notes
```js
function lockScreen() {
  const overlay = document.createElement('div');
  overlay.className = 'lock-overlay';
  overlay.innerHTML = `<div class="lock-icon">🔒</div><div class="lock-hint">Tap corner sequence to unlock</div>`;
  document.body.appendChild(overlay);
  document.body.setAttribute('data-locked', 'true');
}
```
CSS: `.lock-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999; }` Body `[data-locked="true"] * { pointer-events: none; }` Lock overlay `pointer-events: all`.

---

#### W-19 — Multi-touch simultaneous faders (pointerId)

**Importance:** 🟡 Medium  
**Impact:** Two operators (or two hands) can adjust two zone levels simultaneously  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Replace single `touchstart/touchmove` event handling with `pointerdown/pointermove` tracked by `pointerId`. Each fader captures its own pointer ID via `setPointerCapture()`. Multiple faders can be dragged simultaneously without interfering.

##### Why implement?
This is the defining feature of hardware touch-capable consoles (Yamaha CL, DiGiCo SD). The reason tablet mixer apps feel like hardware is `pointerId` — without it only one fader moves at a time.

##### Why NOT implement (or defer)?
Currently faders use `<input type="range">` which handles touch natively. Requires custom fader implementation (W-01) to implement properly.

##### Implementation notes
```js
const activeFaders = new Map(); // pointerId → { el, channel }
faderEl.addEventListener('pointerdown', (e) => {
  faderEl.setPointerCapture(e.pointerId);
  activeFaders.set(e.pointerId, { el: faderEl, channel: i });
});
window.addEventListener('pointermove', (e) => {
  if (activeFaders.has(e.pointerId)) { /* update fader */ }
});
```

---

#### W-20 — Pinch-to-zoom matrix + swipe navigation

**Importance:** 🟡 Medium  
**Impact:** Makes large matrices navigable on 7" screens without button-mediated pagination  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Add a pinch gesture that scales the matrix grid (CSS `transform: scale()`). Add momentum-based pan after pinch. Add a minimap overlay (small corner canvas) showing the full matrix with a visible viewport rect. Swipe left/right switches between channel view tabs.

##### Why implement?
On a 7" screen with 16 inputs × 8 outputs, the matrix at 48 px cells is 768 × 384 px — too wide to see all at once. Pinch-to-zoom lets operators find the cell they want quickly then zoom in to tap it reliably.

##### Why NOT implement (or defer)?
Complex implementation; risk of accidental page reload on over-scroll. Handle carefully with `touch-action: none` on the matrix container. Defer to Sprint 20 after higher-value items are done.

##### Implementation notes
Use the `Hammer.js`-inspired approach with raw Pointer Events: track two `pointerId`s simultaneously; compute distance delta between them; apply `scale()` transform to `#matrix-area`. Clamp scale to [0.4, 2.0].

---

#### W-21 — Haptic feedback via navigator.vibrate()

**Importance:** 🟡 Medium  
**Impact:** Provides tactile confirmation on Android tablets that a button press registered  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Call `navigator.vibrate([10])` (10 ms pulse) on mute/solo toggle, cell toggle, and fader lock engagement. Guard with feature detection. iOS does not support this API — treat gracefully.

##### Why implement?
Tactile feedback is critical in noisy pub environments where visual feedback may be missed. A brief vibration confirms "I successfully muted that channel" without requiring the operator to look at the screen.

##### Why NOT implement (or defer)?
Not supported on iOS. Android-only benefit. Low effort, so worth implementing.

##### Implementation notes
```js
const haptic = (pattern = [10]) => navigator.vibrate?.(pattern);
muteBtn.addEventListener('click', () => { toggleInputMute(i); haptic(); });
```

---

#### W-22 — Responsive tablet layout (portrait and landscape)

**Importance:** 🟠 High  
**Impact:** Makes the app fully usable in both tablet orientations without broken layout  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Audit and fix the responsive breakpoints for 7" (600 × 1024 landscape / 1024 × 600 portrait) and 10" (800 × 1280 landscape) tablet screens. Ensure: meters panel stays visible, scene bar doesn't wrap, strip width adapts, matrix scrolls horizontally without clipping. Add `@media (orientation: landscape)` rules.

##### Why implement?
Tablets at bar tops are placed in both orientations depending on the bar setup. Currently only a single `<900px` breakpoint exists — no landscape-specific rules. The layout breaks in landscape on 7" screens.

##### Why NOT implement (or defer)?
No reason to defer — responsive CSS adjustments with no logic changes.

##### Implementation notes
```css
@media (max-width: 900px) and (orientation: landscape) {
  #meter-panel { width: 80px; }
  .input-strip { width: 100px; }
  --cell-size: 44px;
  --strip-w: 100px;
}
@media (max-width: 900px) and (orientation: portrait) {
  #meter-panel { display: none; } /* reclaim space; meters shown in strip */
  --cell-size: 48px;
}
```

---

## Multi-Zone Management

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-23 | Zone overview dashboard | 🟠 High | Hard | Medium | W-24 |
| W-24 | Zone selector tab / per-bar isolation | 🟠 High | Medium | Low | None |
| W-25 | Zone grouping with linked faders | 🟡 Medium | Hard | Medium | W-24 |
| W-26 | Time-based zone preset scheduler | 🟡 Medium | Hard | Medium | W-24, W-10 |
| W-27 | Per-zone source selector carousel | 🟡 Medium | Medium | Low | W-24 |
| W-28 | Zone isolation (bar staff see only their zone) | 🟡 Medium | Medium | Medium | W-24, W-42 |

---

#### W-24 — Zone selector tab / per-bar isolation

**Importance:** 🟠 High  
**Impact:** Allows each tablet to control only its bar without seeing the full matrix  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a zone configuration to the app: a named set of output channels that constitute one "zone" (bar). The admin defines zones (e.g. "Bar 1" = outputs 0–1, "Bar 2" = outputs 2–3, etc.). A zone selector in the header (or a landing page) filters the matrix view to only that zone's outputs. Zone config stored in localStorage initially, then backend config.

##### Why implement?
The foundational feature for the pub deployment. Bar staff at "Bar 3" should not see or accidentally change "Bar 7" levels. Without zone isolation, every tablet is a full mixing console — overwhelming and dangerous.

##### Why NOT implement (or defer)?
Zone definitions need to be consistent across all tablets eventually (backend-stored). Start with localStorage + a manual admin setup page.

##### Implementation notes
```js
const zones = JSON.parse(localStorage.getItem('zones') || '[]');
// Zone: { name: string, outputIndices: number[], inputIndices: number[] }

function selectZone(zoneIdx) {
  const zone = zones[zoneIdx];
  state.outputOrder = zone.outputIndices;
  state.inputOrder = zone.inputIndices;
  buildUI();
}
```
Add a zone editor modal for admin use to define zones.

---

#### W-23 — Zone overview dashboard (all 7 bars)

**Importance:** 🟠 High  
**Impact:** Gives the admin/sound engineer situational awareness of all zones at once  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** W-24

##### What is it?
A dedicated "Overview" tab (or a collapsible top panel) showing all zones in a compact summary grid: zone name, current source (input label), master level indicator (mini fader or dB readout), mute state, and a mini meter bar. Tapping a zone card expands to full channel strip for that zone. This is the "house view" for the sound engineer overseeing the entire venue.

##### Why implement?
The sound engineer sitting at the main bar needs to see the state of all 7 zones without tapping through each one. The dashboard view is a standard feature in zone-paging systems (Optimal Audio, Extron, QSC).

##### Why NOT implement (or defer)?
Requires W-24 zone definitions to be in place. Complex layout but entirely frontend-driven once zones are defined.

##### Implementation notes
Render zone cards as a CSS grid (2 per row on portrait tablet, 4 per row on landscape). Each card: zone name, source label from `state.inputs[activeInput].label`, mini fader `<input type="range">`, mute button, mini canvas meter. Click card → switch to full zone view (W-24).

---

#### W-27 — Per-zone source selector carousel

**Importance:** 🟡 Medium  
**Impact:** Lets bar staff change the music source for their zone in 2 swipes, no routing knowledge required  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** W-24

##### What is it?
Above each zone's channel strip, add a horizontal swipeable carousel of available input sources (Dante channel names). Swiping left/right cycles through sources. Selecting a source automatically routes it to the zone's outputs (disconnecting the previous source). This is the "simple mode" UI for bar staff who don't understand signal routing.

##### Why implement?
Bar staff are not sound engineers. They need to know "I want to play Spotify in Bar 3" — not "patch input 4 to outputs 6–7". A source carousel abstracts routing to a single swipe.

##### Why NOT implement (or defer)?
Requires W-24 zone definitions. Medium complexity — implement in Sprint 15.

##### Implementation notes
```js
function setZoneSource(zoneIdx, inputIdx) {
  const zone = zones[zoneIdx];
  // Disconnect all current sources for this zone
  zone.inputIndices.forEach(i => zone.outputIndices.forEach(o => applyGain(i, o, 0)));
  // Route new source to all zone outputs
  zone.outputIndices.forEach(o => applyGain(inputIdx, o, 1.0));
}
```
UI: `<div class="source-carousel">` with CSS snap scrolling, one card per input.

---

#### W-25 — Zone grouping with linked faders

**Importance:** 🟡 Medium  
**Impact:** Enables "all upstairs bars" to be controlled with one fader move  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** W-24

##### What is it?
Allow zones to be grouped (e.g. "Upstairs" = Bars 4, 5, 6). A group fader moves all member zone master faders proportionally (gang/VCA mode). A chain-link icon on zone cards indicates group membership. Unlinking (tap chain icon) breaks the group for independent control.

##### Why implement?
In a multi-floor pub, "turn down all upstairs zones" is a common command. Without grouping, this requires individually adjusting 3 zone faders.

##### Why NOT implement (or defer)?
Complex state management for proportional gang movement. Defer to Sprint 19.

##### Implementation notes
Group VCA logic: store the relative offset of each member zone fader from the group master. When group master moves by ΔdB, each member moves by ΔdB (absolute) while clamping to valid range.

---

#### W-26 — Time-based zone preset scheduler

**Importance:** 🟡 Medium  
**Impact:** Automates routine scene transitions (happy hour → evening → closing time)  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** W-24, W-10

##### What is it?
A scheduler UI (simple table: time → scene name, per day of week). At the scheduled time, the Rust backend loads the specified scene. The frontend shows a "Next scheduled event" indicator in the header. Useful for: "at 23:00 every night, apply 'Late Night Low Volume' preset".

##### Why implement?
Reduces operator workload for predictable daily transitions. Standard in commercial zone controllers (Extron, Biamp Tesira).

##### Why NOT implement (or defer)?
Requires backend scheduler support (cron-like timer in Rust). Complex to implement safely (scene load must be atomic, race condition with manual changes). Defer to Sprint 19.

##### Implementation notes
Backend: `config.schedule: Vec<ScheduleEntry>` where `ScheduleEntry = { time: NaiveTime, days: [bool;7], scene: String }`. A Tokio interval task checks every minute. Frontend: a schedule editor modal.

---

#### W-28 — Zone isolation by auth role (bar staff see only their zone)

**Importance:** 🟡 Medium  
**Impact:** Prevents bar staff from accidentally affecting other zones; enforces authority boundaries  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** W-24, W-42 (WS auth)

##### What is it?
Extend the API key role system (already implemented in the backend) so that `BarStaff` role API keys are associated with a specific zone. When a BarStaff key authenticates, the WS initial snapshot only includes their zone's inputs and outputs. The frontend automatically selects that zone.

##### Why implement?
Client-side zone filtering (W-24) can be bypassed by a savvy operator. True isolation requires the backend to enforce zone scope per auth token.

##### Why NOT implement (or defer)?
Requires backend changes to associate zone metadata with API keys. Defer to Sprint 15 or later once zone definitions are stable.

##### Implementation notes
Backend: add `zone: Option<String>` to `ApiKeyEntry` in config. In WS handler: filter `StateSnapshot.inputs[]` and `outputs[]` to only zone members if `role == BarStaff`. Frontend: receives pre-filtered snapshot; no zone picker UI needed for staff.

---

## Metering & Visualisation

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-29 | Gain reduction meter on compressor | 🟠 High | Medium | Medium | None |
| W-30 | Clip latch indicator | 🟠 High | Easy | Low | None |
| W-31 | Pre-cache canvas gradient (GC fix) | 🟡 Medium | Easy | Low | None |
| W-32 | Peak-hold decay rate configurable | 🟡 Medium | Easy | Low | None |
| W-33 | RMS meter bar alongside peak | 🟡 Medium | Medium | Low | W-31 |
| W-34 | Master bus stereo L/R meter | 🟡 Medium | Medium | Low | W-33 |
| W-35 | Signal presence pulse on active cells | 🟡 Medium | Easy | Low | None |

---

#### W-29 — Gain reduction meter on compressor strip

**Importance:** 🟠 High  
**Impact:** Shows operators when and how much compression is active, preventing over-compression  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
Add a small gain-reduction (GR) meter to each output channel's compressor button. When the compressor is engaged, the GR meter shows a red bar descending from 0 dB downward (indicating how many dB of gain are being applied). The backend must send GR values in the WS meter frame.

##### Why implement?
Without visual GR feedback, operators have no idea the compressor is working. A compressor with a too-low threshold can silently squash transients, making the sound system feel lifeless.

##### Why NOT implement (or defer)?
Requires backend DSP to track and expose GR per output channel in the WS binary frame. Medium complexity change. Implement in Sprint 18.

##### Implementation notes
Backend: add `gr_db: f32` per output channel to the WS meter frame (append after the existing values). Frontend: draw a separate `<canvas>` below the C button on each output strip, rendered red from 0 downward by GR amount.

---

#### W-30 — Clip latch indicator

**Importance:** 🟠 High  
**Impact:** Ensures operators notice and investigate signal clipping even if it was momentary  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a red "CLIP" latch that lights on the meter row when the level exceeds −1 dBFS. Unlike the regular peak meter, the latch stays lit until the operator explicitly clicks it to reset (or presses a global "reset clips" button in the header). Count consecutive clip events and display the count.

##### Why implement?
Transient clipping often occurs for milliseconds — too brief to see on a live meter. A latch ensures the operator knows to investigate. Standard on all professional meters (SSL, Neve, every DAW).

##### Why NOT implement (or defer)?
No reason to defer — simple state flag addition alongside the existing peak-hold logic.

##### Implementation notes
```js
const clipLatches = new Array(totalChannels).fill(false);
function updateClipLatch(channelIdx, dbfs) {
  if (dbfs >= -1.0 && !clipLatches[channelIdx]) {
    clipLatches[channelIdx] = true;
    const latch = document.querySelector(`[data-clip="${channelIdx}"]`);
    latch?.classList.add('clipped');
  }
}
```
Add a `<span class="clip-latch" data-clip="N">CLIP</span>` above each meter canvas.

---

#### W-31 — Pre-cache canvas gradient (fix GC pressure)

**Importance:** 🟡 Medium  
**Impact:** Eliminates GC pauses at 60 fps caused by gradient object allocation in the rAF loop  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
The current `drawMeterCanvas()` creates a `createLinearGradient()` object on every animation frame for every meter canvas. At 60 fps × 16 canvases, this allocates ~960 gradient objects per second, each collected shortly after. Move gradient creation outside the loop and cache per-channel.

##### Why implement?
Short-lived gradient objects create steady GC pressure. On Android Chrome, this causes periodic 16–50 ms GC pauses that manifest as meter flicker or dropped frames.

##### Why NOT implement (or defer)?
One-line fix; no reason to defer.

##### Implementation notes
```js
const cachedGradients = new Map(); // canvas.id → gradient
function getOrCreateGradient(canvas, ctx) {
  if (!cachedGradients.has(canvas.id) || canvas.width !== lastWidth.get(canvas.id)) {
    const g = ctx.createLinearGradient(0, 0, canvas.width, 0);
    g.addColorStop(0.0, '#3aff6a'); g.addColorStop(0.7, '#ff9a3a'); g.addColorStop(1.0, '#ff3a3a');
    cachedGradients.set(canvas.id, g);
    lastWidth.set(canvas.id, canvas.width);
  }
  return cachedGradients.get(canvas.id);
}
```

---

#### W-32 — Peak-hold decay rate configurable in UI

**Importance:** 🟡 Medium  
**Impact:** Lets operators tune peak-hold to their preference (slow for transient watching, fast for live monitoring)  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a small settings popover (gear icon in the meter panel header) with a single slider: "Peak Hold Decay" from "Fast (1s)" to "Infinite (manual reset)". Store in localStorage. Currently hardcoded to `PEAK_DECAY = 0.5 dB/frame`.

##### Why implement?
Sound engineers prefer different decay rates for different use cases. Slow decay (or infinite hold) is preferred when monitoring transient-heavy material; fast decay suits live mixing.

##### Why NOT implement (or defer)?
Trivial UI addition. Low priority but quick to implement.

##### Implementation notes
```js
let PEAK_DECAY = parseFloat(localStorage.getItem('peak-decay') ?? '0.5');
// Slider: 0.1 (fast) to 0 (infinite hold, decay = 0)
```

---

#### W-33 — RMS meter bar alongside peak

**Importance:** 🟡 Medium  
**Impact:** Shows average loudness vs transient peak — more meaningful for zone level monitoring  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** W-31

##### What is it?
Render a second, narrower bar on each meter canvas representing the rolling RMS (300 ms window) in a muted grey-blue colour behind the peak bar. RMS is computed from the peak values sent over WS (or the backend sends both peak and RMS). Gives a visual distinction between transient activity and sustained loudness.

##### Why implement?
In a pub, the goal is a comfortable sustained loudness — not just peak level. An RMS bar immediately shows whether the zone sounds loud or just spiky, reducing operator guesswork.

##### Why NOT implement (or defer)?
Requires either JS-side RMS accumulation (approximate, since we only get one dBFS value per channel per WS frame) or backend RMS computation. JS-side approximation is acceptable for Sprint 18.

##### Implementation notes
```js
const rmsWindow = new Array(totalCh).fill(null).map(() => new Float32Array(30)); // 30 frames @ ~30Hz = 1s
let rmsIdx = 0;
function updateRms(ch, dbfs) {
  rmsWindow[ch][rmsIdx % 30] = Math.pow(10, dbfs / 20);
  const rms = 20 * Math.log10(Math.sqrt(rmsWindow[ch].reduce((s,v) => s+v*v,0) / 30));
  return rms;
}
```

---

#### W-34 — Master bus stereo L/R meter

**Importance:** 🟡 Medium  
**Impact:** Provides a clear "overall venue level" reference for the sound engineer  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** W-33

##### What is it?
Add a prominent stereo L/R master bus meter at the top of the meter panel (or in the header). Displays the peak level across all output channels combined (or a designated "master pair" if defined). Larger than channel meters (3× height). Includes clip latch and −10/−3/0 dBFS markers.

##### Why implement?
The sound engineer needs one quick glance to confirm the overall venue level is correct. Having to scan 7 individual zone meters is slower and less reliable.

##### Why NOT implement (or defer)?
Dependent on W-33 for the RMS component. Straightforward additional canvas element.

##### Implementation notes
Compute master peak as `Math.max(...outputs)` or sum of a configured master output pair. Draw a larger canvas (double height) at the top of `#meter-panel` with dB scale markings.

---

#### W-35 — Signal presence pulse on active matrix cells

**Importance:** 🟡 Medium  
**Impact:** Shows live signal flow through the routing matrix at a glance  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
When an active matrix cell's input channel has a non-zero signal (based on `dante_rx_active` bitmask or meter level > −60 dBFS), animate the cell with a subtle pulse (CSS `box-shadow` glow that cycles every ~2 seconds). This visually distinguishes "routed and active" from "routed but silent".

##### Why implement?
A routed-but-silent channel (muted source, cable issue) looks identical to a routed-and-active channel on the current matrix. A pulse differentiates them without adding complexity.

##### Why NOT implement (or defer)?
CSS animation only; no logic changes needed. Use the existing `dante_rx_active` bitmask.

##### Implementation notes
```css
.matrix-cell.active.signal-present {
  animation: cell-pulse 2s ease-in-out infinite;
}
@keyframes cell-pulse {
  0%,100% { box-shadow: 0 0 0 rgba(74,158,255,0); }
  50%      { box-shadow: 0 0 8px rgba(74,158,255,0.5); }
}
```
In JS: add `.signal-present` class to cell when `state.danteRxActive[i]` is true.

---

## Security

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-41 | Content Security Policy header | 🔴 Critical | Easy | Low | None |
| W-42 | Authenticate WebSocket upgrade | 🔴 Critical | Medium | Medium | None |
| W-43 | Escape HTML in all innerHTML paths | 🔴 Critical | Easy | Low | BUG-W02 |
| W-44 | Binary WS message bounds checking | 🟡 Medium | Easy | Low | BUG-W04 |

---

#### W-41 — Content Security Policy header in Rust backend

**Importance:** 🔴 Critical  
**Impact:** Blocks XSS escalation and restricts script/style sources at the browser level  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a `Content-Security-Policy` HTTP response header to all asset responses from the Rust backend. The policy should: restrict `script-src` to `'self'`, `style-src` to `'self' https://fonts.googleapis.com`, `font-src` to `https://fonts.gstatic.com`, block `object-src 'none'`, set `default-src 'self'`.

##### Why implement?
Without CSP, any XSS vulnerability (like BUG-W02) escalates to full script execution. CSP is a browser-enforced safety net that limits the blast radius of injection vulnerabilities.

##### Why NOT implement (or defer)?
Breaking change if any inline styles exist (they do — check before deploying). Self-host fonts (W-51) should be done alongside to simplify the CSP to `'self'` only.

##### Implementation notes
```rust
// crates/patchbox/src/api/assets.rs — add to serve_embedded_asset():
.header("Content-Security-Policy",
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; \
   font-src https://fonts.gstatic.com; object-src 'none'; base-uri 'self'")
```
Or set globally in the `tower_http` middleware layer.

---

#### W-42 — Authenticate WebSocket upgrade with API key

**Importance:** 🔴 Critical  
**Impact:** Closes unauthenticated meter data streaming and state snapshot access  
**Difficulty:** Medium  
**Risk:** Medium  
**Prerequisites:** None

##### What is it?
The `/ws` endpoint currently has no authentication — any browser or script can connect and receive full state snapshots + continuous meter data. Add API key validation on the WS upgrade request: accept key as a URL query param (`?key=xxx`) or in the `Sec-WebSocket-Protocol` header (the only header WS clients can customise).

##### Why implement?
Any device on the LAN can connect to `ws://10.10.1.53:9191/ws` and receive full mixer state and meter data. In a pub with public Wi-Fi, this is a real risk.

##### Why NOT implement (or defer)?
Frontend tablets must be updated to pass the key. Store the key in localStorage and append to the WS URL. Coordinate the backend change with the frontend key-passing change in the same sprint.

##### Implementation notes
```rust
// crates/patchbox/src/api/mod.rs — add auth check:
.route("/ws", get(ws::ws_handler).layer(require_api_key_ws))

// New middleware: extract ?key= from URL query string
```
```js
// app.js — pass key on WS connect:
const key = localStorage.getItem('api-key') || '';
const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(key)}`);
```
Add an API key setup screen on first run (stored in localStorage, never sent to any external server).

---

## Performance

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-45 | Incremental DOM updates | 🟠 High | Hard | Medium | BUG-W03 |
| W-46 | Event listener cleanup with AbortController | 🟡 Medium | Medium | Low | BUG-W03 |
| W-47 | Cache canvas offsetWidth outside rAF loop | 🟡 Medium | Easy | Low | None |
| W-48 | Virtual row rendering for large matrices | 🟡 Medium | Hard | Medium | W-45 |
| W-49 | GPU-composited fader knob | 🟡 Medium | Easy | Low | W-01 |

---

#### W-45 — Incremental DOM updates (no full rebuild per state change)

**Importance:** 🟠 High  
**Impact:** Eliminates 100–300 ms UI freeze on WS snapshot updates for large channel counts  
**Difficulty:** Hard  
**Risk:** Medium  
**Prerequisites:** BUG-W03

##### What is it?
Replace the current `buildUI()` full-rebuild strategy with a diff-and-patch approach: compare the incoming snapshot to the current state and update only changed DOM nodes (gains, mute states, labels). Use a keyed map of row elements by channel index so only changed rows are touched.

##### Why implement?
Currently, every WS `snapshot` message triggers `buildUI()` which clears and rebuilds the entire DOM (~56 cells + 16 strips). On a slow Android tablet, this causes a visible flash and 100–300 ms freeze. On a 7" bar tablet this is very noticeable.

##### Why NOT implement (or defer)?
This is the largest refactor in the list. Requires careful state tracking to avoid missed updates. Worth doing in Sprint 20 after the layout is stabilised by the redesign sprints.

##### Implementation notes
```js
const rowEls = new Map(); // inputIdx → .matrix-row element
const cellEls = new Map(); // `${i},${o}` → .matrix-cell element

function patchUI(prevState, nextState) {
  // Only update what changed
  nextState.inputs.forEach((inp, i) => {
    if (inp.mute !== prevState.inputs[i]?.mute)
      rowEls.get(i)?.querySelector('.btn-mute')?.classList.toggle('active', inp.mute);
    // ... etc
  });
}
```

---

#### W-47 — Cache canvas offsetWidth outside rAF loop

**Importance:** 🟡 Medium  
**Impact:** Removes a forced layout reflow per meter canvas per animation frame  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
`paintMeters()` calls `canvas.parentElement?.offsetWidth - 48` on every `requestAnimationFrame` tick. Reading `offsetWidth` forces the browser to flush pending layout calculations — a synchronous layout reflow. At 60 fps × 16 canvases, this is 960 layout flushes per second.

##### Why implement?
A reflow-in-rAF is one of the classic browser performance anti-patterns. Cache the width on `resize` events and after `buildUI()`. The width rarely changes.

##### Why NOT implement (or defer)?
10-minute fix with measurable impact on old Android tablets.

##### Implementation notes
```js
const meterWidths = new Map(); // canvas id → cached width
window.addEventListener('resize', () => meterWidths.clear());

function getMeterWidth(canvas) {
  if (!meterWidths.has(canvas.id)) {
    meterWidths.set(canvas.id, canvas.parentElement.offsetWidth - 48);
  }
  return meterWidths.get(canvas.id);
}
```

---

## Accessibility

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-36 | Full ARIA on all custom controls | 🟡 Medium | Medium | Low | None |
| W-37 | Complete keyboard navigation | 🟡 Medium | Medium | Low | W-36 |
| W-38 | Focus trap in modals + ESC to close | 🟡 Medium | Easy | Low | None |
| W-39 | High-contrast CSS theme variant | 🟡 Medium | Easy | Low | W-56 |
| W-40 | prefers-color-scheme + light theme | 🟡 Medium | Medium | Low | W-56 |

---

#### W-36 — Full ARIA on all custom controls

**Importance:** 🟡 Medium  
**Impact:** Makes the app usable with screen readers and assistive technology  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add appropriate ARIA attributes to all interactive elements: faders get `role="slider"` + `aria-valuenow` + `aria-valuemin` + `aria-valuemax` + `aria-label`; mute/solo buttons get `aria-pressed`; modals get `role="dialog"` + `aria-modal` + `aria-labelledby`; matrix cells get `role="checkbox"` + `aria-checked` + `aria-label="Route [Input] to [Output]"`.

##### Why implement?
Without ARIA, screen reader users hear nothing useful. Also required for WCAG 2.1 AA compliance. Some operators may have visual impairments.

##### Why NOT implement (or defer)?
Medium effort but high correctness requirement — incorrect ARIA is worse than none. Defer until Sprint 21.

##### Implementation notes
Update `buildInputRow()`, `buildCell()`, and modal HTML. Add a `aria-live="polite"` region for toast messages so screen readers announce them.

---

#### W-38 — Focus trap in modals + ESC to close

**Importance:** 🟡 Medium  
**Impact:** Makes modals keyboard-navigable and prevents focus escaping to background  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
When the EQ or Compressor modal opens: (1) move focus to the first interactive element inside the modal, (2) trap Tab/Shift+Tab within the modal, (3) pressing ESC closes the modal and returns focus to the trigger button.

##### Why implement?
Currently modals don't manage focus. Pressing Tab while the EQ modal is open moves focus to elements behind the overlay — invisible to the user but still interactive.

##### Why NOT implement (or defer)?
Easy 20-line fix; affects accessibility and general keyboard usability.

##### Implementation notes
```js
function trapFocus(modal) {
  const focusable = modal.querySelectorAll('button,input,select,[tabindex]:not([tabindex="-1"])');
  const first = focusable[0], last = focusable[focusable.length - 1];
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal(modal);
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  first.focus();
}
```

---

## Developer Experience

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-50 | PWA manifest + service worker | 🟡 Medium | Medium | Low | None |
| W-51 | Self-host Google Fonts (bundle into binary) | 🟡 Medium | Easy | Low | None |
| W-52 | HTTP cache headers for static assets | 🟡 Medium | Easy | Low | None |
| W-53 | Dev-mode hot reload (fs-watcher) | 🟡 Medium | Medium | Low | None |

---

#### W-50 — PWA manifest + service worker (Workbox)

**Importance:** 🟡 Medium  
**Impact:** Enables "Add to Home Screen" for a native-app experience on bar tablets  
**Difficulty:** Medium  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add a `manifest.json` (app name "dante-patchbox", standalone display, dark theme colour #0a0a0f, 192 × 192 and 512 × 512 icon PNGs) and a simple service worker that caches `index.html`, `app.js`, and `style.css` on first load. On offline/network error, serve the cached shell. Embed both files via `rust-embed`.

##### Why implement?
Bar tablets should have the app as a home screen icon. Standalone mode removes browser chrome (address bar, tabs) for a full-screen experience. Service worker caching survives momentary Wi-Fi drops in a noisy pub RF environment.

##### Why NOT implement (or defer)?
Service worker caching can cause stale UI after app updates — must include a cache-busting strategy (version hash in the SW registration). Manage carefully.

##### Implementation notes
```json
// web-ui/manifest.json
{ "name": "Dante Patchbox", "short_name": "Patchbox",
  "display": "standalone", "theme_color": "#0a0a0f",
  "background_color": "#0a0a0f",
  "start_url": "/", "icons": [{"src":"/icon-192.png","sizes":"192x192"},{"src":"/icon-512.png","sizes":"512x512"}] }
```
Add `<link rel="manifest" href="/manifest.json">` and `<meta name="theme-color" content="#0a0a0f">` to index.html.

---

#### W-51 — Self-host Google Fonts (bundle into binary)

**Importance:** 🟡 Medium  
**Impact:** Eliminates CDN dependency; improves load time and enables offline use  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Download the IBM Plex Mono (400, 500, 600) and Barlow Condensed (400, 500, 600, 700) WOFF2 files. Place them in `web-ui/fonts/`. Serve them via the existing `rust-embed` asset handler. Replace the Google Fonts CDN `<link>` with local `@font-face` declarations in `style.css`.

##### Why implement?
Currently the app requires a network round-trip to `fonts.googleapis.com` on first load. In a pub where the internet connection might be patchy, the UI renders with fallback fonts until Google Fonts loads. Also required to properly implement CSP (W-41) without allowing external font CDN.

##### Why NOT implement (or defer)?
Font files add ~200–500 KB to the binary. Brotli compression brings this to ~80–150 KB. Acceptable.

##### Implementation notes
```css
/* Replace Google Fonts link with: */
@font-face { font-family: 'IBM Plex Mono'; font-weight: 400; font-display: swap;
  src: url('/fonts/ibm-plex-mono-400.woff2') format('woff2'); }
/* ...etc for each weight */
```
Use `google-webfonts-helper.herokuapp.com` to download the WOFF2 files.

---

#### W-52 — HTTP cache headers for static assets

**Importance:** 🟡 Medium  
**Impact:** Eliminates redundant re-downloads of unchanged assets on every page load  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** None

##### What is it?
Add `Cache-Control: public, max-age=31536000, immutable` to `app.js` and `style.css` responses (with a content-hash URL fragment for cache-busting). Add `Cache-Control: no-cache` to `index.html` so the browser always checks for a new version. The existing `rust-embed` handler needs these headers added.

##### Why implement?
Currently, every page load re-downloads all 76 KB of assets. On a slow pub Wi-Fi, this adds 300–500 ms. Long-lived cache headers eliminate this on repeat visits.

##### Why NOT implement (or defer)?
Requires URL-based cache-busting (e.g. `/app.js?v=af74401`) otherwise stale JS is served after updates. Implement with a build-time version hash injected via `CARGO_PKG_VERSION` or git commit hash.

##### Implementation notes
```rust
// assets.rs — add version-based cache headers:
let max_age = if path.ends_with(".html") { 0 } else { 31_536_000 };
response.headers_mut().insert(CACHE_CONTROL, format!("public, max-age={max_age}").parse()?);
```

---

## Visual Design & Polish

### Summary Table

| ID | Title | Importance | Difficulty | Risk | Prerequisites |
|----|-------|------------|------------|------|---------------|
| W-55 | Full UI aesthetic redesign | 🟠 High | Hard | Low | W-16, W-04 |
| W-56 | Dark/light theme toggle | 🟡 Medium | Easy | Low | W-55 |
| W-57 | Scene thumbnail preview card | 🟡 Medium | Medium | Low | None |
| W-58 | Onboarding overlay (first-run tour) | 🟢 Low | Medium | Low | W-55 |
| W-59 | Toast stack (multiple, click to dismiss) | 🟢 Low | Easy | Low | BUG-W01 |
| W-60 | Animated signal flow lines on active cells | 🟢 Low | Medium | Low | W-55 |

---

#### W-55 — Full UI aesthetic redesign (industrial/utilitarian, amber accents)

**Importance:** 🟠 High  
**Impact:** Creates a distinctive, professional-grade identity; makes the app feel like a real product  
**Difficulty:** Hard  
**Risk:** Low  
**Prerequisites:** W-16 (touch targets must be correct first), W-04 (mute/solo colours defined first)

##### What is it?
A complete CSS and HTML restructuring applying the Anthropic frontend-design skill. Aesthetic direction: **industrial/utilitarian** — dark steel backgrounds, amber/orange VU meter accents (vintage hardware feel), IBM Plex Mono for channel names, Barlow Condensed for labels. Bold section separators, subtle grain texture overlay on backgrounds, strong orange clip indicators. The layout: a proper dense channel strip column on the left, a routing matrix, a tall meter tower on the right.

The redesign implements the **frontend-design skill** aesthetic guidelines:
- **Tone:** Industrial/Utilitarian — deliberate, unapologetic density
- **Palette:** Near-black backgrounds (`#0d0d0f`), amber accent (`#f59e0b`), safety red (`#dc2626`), status green (`#22c55e`)
- **Typography:** IBM Plex Mono (channel names, values, meters), Barlow Condensed Bold (labels, headers, buttons)
- **Layout:** Dense grid, no wasted space, strong horizontal banding
- **Motion:** Fader drag with `will-change: transform`, meter bars with GPU-composited canvas, cell toggle with 80ms scale micro-animation
- **Texture:** Subtle noise grain on the header and section dividers
- **Differentiation:** Looks like a hardware rack unit — not a web app

##### Why implement?
The current UI is functional but generic. A distinctive industrial look makes the app memorable, builds confidence in its professional capabilities, and reduces the "web app" mental model that leads operators to treat it as less reliable than hardware.

##### Why NOT implement (or defer)?
Pure CSS/HTML change — no logic changes. Low risk. Should be done before adding new features (W-01, W-06) so those features inherit the new design system from the start.

##### Implementation notes
See `frontend-design` skill guidelines. Key changes:
1. Update all CSS variables in `style.css`: `--accent: #f59e0b`, `--accent-dim: #78350f`, add `--danger: #dc2626`, add `--noise-opacity: 0.03`
2. Add noise texture via CSS `background-image: url("data:image/svg+xml,...")` or a CSS filter trick
3. Increase `--cell-size: 48px`, `--strip-w: 140px`
4. Redesign header: bold `DANTE PATCHBOX` wordmark in Barlow Condensed, status badges as pill components
5. Redesign matrix cells: rounder corners, amber glow on active, numbered input axis labels
6. Redesign scene bar: full-width footer with clear visual separation

---

#### W-56 — Dark/light theme toggle with localStorage

**Importance:** 🟡 Medium  
**Impact:** Allows use in well-lit daytime settings where dark theme is less readable  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** W-55

##### What is it?
Add a theme toggle button (sun/moon icon) in the header. Switching writes `theme = 'light'|'dark'` to localStorage and sets `document.documentElement.dataset.theme`. CSS `[data-theme=light]` block overrides all dark-mode variables to a light equivalent. Also responds to `@media (prefers-color-scheme: light)` on first load.

##### Why implement?
Bar staff may use the app at noon in a brightly lit venue where a dark screen is hard to read. A light theme option costs almost nothing after the dark theme's CSS variables are well-structured.

##### Why NOT implement (or defer)?
Requires W-55 to be complete first (needs well-structured CSS variables). Defer accordingly.

##### Implementation notes
```css
[data-theme="light"] {
  --bg: #f5f5f0; --bg-2: #e8e8e2; --text: #1a1a1a; --accent: #d97706;
  --cell-off: #dcdcd5; --cell-on: #fbbf24;
}
```

---

#### W-59 — Toast stack (multiple simultaneous, click to dismiss)

**Importance:** 🟢 Low  
**Impact:** Prevents rapid API operations from overwriting each other's feedback toasts  
**Difficulty:** Easy  
**Risk:** Low  
**Prerequisites:** BUG-W01

##### What is it?
Replace the single `#toast` span with a `#toast-container` that stacks multiple toast cards vertically. Each toast has a close button, auto-dismisses after 3 s, and slides in/out with a CSS animation. Toasts are typed: success (green), warning (amber), error (red).

##### Why implement?
When an operator makes rapid changes (mute 3 channels quickly), only the last toast is visible. Earlier confirmations are lost. The stack ensures every action's feedback is visible.

##### Why NOT implement (or defer)?
Low priority — mostly polish. Easy to implement.

##### Implementation notes
```js
function toast(msg, type = 'ok', duration = 3000) {
  const card = document.createElement('div');
  card.className = `toast-card toast-${type}`;
  card.textContent = msg;
  card.onclick = () => card.remove();
  document.getElementById('toast-container').appendChild(card);
  setTimeout(() => card.classList.add('toast-exit'), duration - 300);
  setTimeout(() => card.remove(), duration);
}
```

---

## Process Instructions (permanent — saved in this file)

These instructions govern how improvements are selected and implemented. They must not be lost.

1. **Complete ALL items in a sprint before starting the next sprint.**
2. **After each sprint:** run `cargo build --release`, deploy to `10.10.1.53:9191`, confirm in browser, git commit + push.
3. **Generate new improvements ONLY after all current sprint todos are done** — evaluate the current state at that point.
4. **`docs/PROJECT.md`** is the permanent project context. Update the Sprint Status table after each sprint.
5. **`IMPROVEMENT_ROADMAP.md`** (v1) covers backend/Dante items; this file (`IMPROVEMENT_ROADMAP_v2.md`) covers web UI items.
6. **Mark items resolved** in this document after completing them (add to resolved table at top).
7. **Design tool:** Use the `frontend-design` skill when implementing W-55 and subsequent design-heavy items.
8. **Pub sound system context:** The primary users are bar staff (non-technical, tablets on bar tops) and one sound engineer (admin view). Every feature decision must pass the "is this usable by a bar person under pressure?" test.
9. **Sprint scope:** Aim for 6–10 items per sprint. Prioritise Critical > High > Medium.
10. **Auth context:** The venue has ~7 bars. Bar staff API keys are scoped to their zone. Admin API keys have full access. TLS is available via `--tls-cert`/`--tls-key`.
