# Minos Design System

> **Read this before writing any UI code.** Every agent working on a sprint must understand and
> adhere to this specification. No freestyle aesthetics — consistency is more important than
> creativity when building a professional tool.

---

## 1. Design Philosophy

**Aesthetic: Industrial DSP Console**

Minos is a Dante AoIP routing matrix and DSP mixer for a live bar venue. Its primary users are
audio engineers and bar staff who need immediate situational awareness and fast interaction. The UI
should feel like a physical hardware console — not a web app.

**Core principles:**
- **Density over whitespace** — pack meaningful information. Every pixel should serve a function.
- **Color as signal, not decoration** — color communicates status, type, and state. Never use color
  purely for aesthetics.
- **Monospace everything** — IBM Plex Mono is non-negotiable. It provides visual rhythm, aligns
  numbers, and reinforces the industrial character.
- **No drop-shadows, no gradients on surfaces** — flat dark surfaces only. Depth is achieved
  through layered background shades, not shadows.
- **No rounded corners on primary surfaces** — 2px radius maximum. This is a tool, not a consumer
  app.
- **Status always visible** — WS connection, PTP sync, active routes — always on screen.

**The user is not a tourist.** They know the app. Optimize for repeat use, not onboarding.

---

## 2. Color System

All colors are defined as CSS custom properties in `web/src/css/base.css`. **Always use the
variable — never hardcode hex values.**

### Backgrounds (darkest to lightest)

| Variable          | Hex       | Usage                                       |
|-------------------|-----------|---------------------------------------------|
| `--bg-dark`       | `#13151c` | Sidebar, nav bar, deepest layer             |
| `--bg-workspace`  | `#1a1d24` | Main page background                        |
| `--bg-surface`    | `#1e2230` | Cards, panels, channel strip bodies         |
| `--bg-input`      | `#0f1117` | Text inputs, select boxes, meter backgrounds|
| `--bg-row-hover`  | `#1f2330` | Hovered row/strip                           |
| `--bg-row-sel`    | `#1e2740` | Selected/focused row                        |

### Borders

| Variable           | Hex       | Usage                                      |
|--------------------|-----------|--------------------------------------------|
| `--border-primary` | `#2d3140` | Standard dividers, panel outlines          |
| `--border-subtle`  | `#1a1d2a` | Subtle separation within dark surfaces     |

### Text

| Variable            | Hex       | Usage                                     |
|---------------------|-----------|-------------------------------------------|
| `--text-primary`    | `#e6edf3` | Body text, labels, channel names          |
| `--text-secondary`  | `#c9d1d9` | Secondary labels, less important values   |
| `--text-muted`      | `#8b949e` | Placeholder, disabled, inactive           |
| `--text-dim`        | `#484f58` | Very faint — timestamps, decorative       |
| `--text-accent`     | `#58a6ff` | Links, accent text (= `--color-accent`)   |

### Semantic / Status

| Variable          | Hex       | Usage                                       |
|-------------------|-----------|---------------------------------------------|
| `--color-accent`  | `#58a6ff` | Active nav, focus ring, selected state, local-type badge |
| `--color-ok`      | `#3fb950` | Connected, synced, passing, Dante badge     |
| `--color-warn`    | `#d29922` | Warning, active crosspoint, Dante source    |
| `--color-danger`  | `#f85149` | Error, mute active, clip, offline           |
| `--focus`         | `#58a6ff` | Keyboard focus ring (= `--color-accent`)    |

### VU Meter & Signal Level

| Variable      | Hex       | Usage                                           |
|---------------|-----------|-------------------------------------------------|
| `--vu-green`  | `#3fb950` | Normal signal level (–60 to –9 dBFS)            |
| `--vu-amber`  | `#d29922` | High signal level (–9 to –3 dBFS)               |
| `--vu-red`    | `#f85149` | Clip / over (above –3 dBFS)                     |
| `--meter-bg`  | `#0f1117` | Meter bar track background                      |

### Status Dots

| Variable         | Hex       | Usage                                        |
|------------------|-----------|----------------------------------------------|
| `--dot-live`     | `#3fb950` | Connected / synced                           |
| `--dot-offline`  | `#484f58` | Offline / disconnected                       |
| `--dot-error`    | `#f85149` | Error state                                  |

### Controls

| Variable               | Hex       | Usage                                  |
|------------------------|-----------|----------------------------------------|
| `--fader-track`        | `#2d3140` | Fader rail background                  |
| `--fader-thumb`        | `#8b949e` | Fader knob — idle                      |
| `--fader-thumb-sel`    | `#58a6ff` | Fader knob — selected/dragging         |
| `--mute-active`        | `#f85149` | MUTE button when engaged               |
| `--solo-active`        | `#d29922` | SOLO button when engaged               |

### Matrix Crosspoints

| Variable       | Hex       | Usage                                           |
|----------------|-----------|-------------------------------------------------|
| `--xp-local`   | `#58a6ff` | Active route — local ALSA source                |
| `--xp-dante`   | `#d29922` | Active route — Dante source                     |

### DSP Chip Colors

DSP block buttons (AEC, AFS, AM, AXM, CMP, DEQ, FLT, GTE, PEQ) each have a distinct color pair:
a dark background and a brighter text/border. This is **functional** — engineers identify blocks
by color at a glance, not by reading the label.

| Variable              | BG Hex    | Text Hex  | Block                          |
|-----------------------|-----------|-----------|--------------------------------|
| `--chip-aec-bg`       | `#3d1414` | `#c96060` | Acoustic Echo Cancellation     |
| `--chip-afs-bg`       | `#3d2408` | `#c97840` | Adaptive Feedback Suppression  |
| `--chip-am-bg`        | `#38103a` | `#b060b0` | Ambient Mic (gain rider)       |
| `--chip-axm-bg`       | `#0c3030` | `#38a8a8` | Automixer (Dugan-style)        |
| `--chip-cmp-bg`       | `#123018` | `#42a055` | Compressor                     |
| `--chip-deq-bg`       | `#2a2e08` | `#9aa830` | Dynamic EQ                     |
| `--chip-flt-bg`       | `#082030` | `#2e90b0` | High/Low-pass Filter           |
| `--chip-gte-bg`       | `#0a2818` | `#307850` | Gate / Expander                |
| `--chip-peq-bg`       | `#0a2030` | `#2e809a` | Parametric EQ                  |
| `--chip-text`         | —         | use above | (no shared chip text color)    |

**Chip states:**
- **Inactive / bypassed**: background at 40% opacity, text at 60% opacity
- **Active**: full opacity — `.badge` class
- **Modal open**: `filter: brightness(1.5)` + border — `.blk-open` modifier

### Zone Palette (10 colors, cycling)

Used to color-code zone headers and crosspoint columns. Assigned by zone index mod 10.

```
--zone-color-0: #58a6ff  --zone-color-1: #3fb950  --zone-color-2: #d29922
--zone-color-3: #c678dd  --zone-color-4: #f0883e  --zone-color-5: #85c46a
--zone-color-6: #ff7b72  --zone-color-7: #79c0ff  --zone-color-8: #56d364
--zone-color-9: #e3b341
```

### Section Accent Colors

| Variable        | Hex       | Usage                                        |
|-----------------|-----------|----------------------------------------------|
| `--vca-color`   | `#a855f7` | VCA group headers and borders                |
| `--color-bus`   | `#d29922` | Bus section headers and borders              |
| `--gen-sine`    | `#0891b2` | Sine wave generator badge                    |
| `--gen-white`   | `#94a3b8` | White noise generator badge                  |
| `--gen-pink`    | `#f472b6` | Pink noise generator badge                   |
| `--gen-sweep`   | `#f59e0b` | Frequency sweep generator badge              |

---

## 3. Typography

**One font. Always.**

```
font-family: 'IBM Plex Mono', 'Consolas', 'SF Mono', monospace;
font-size: 13px;
```

IBM Plex Mono is loaded from `/fonts/IBMPlexMono-Regular.woff2` (400) and
`/fonts/IBMPlexMono-Medium.woff2` (500). No external CDN requests.

### Type Scale

| Use case                | Size  | Weight | Transform    | Notes                        |
|-------------------------|-------|--------|--------------|------------------------------|
| Body / labels           | 13px  | 400    | none         | Default                      |
| Section headers         | 11px  | 500    | `uppercase`  | `letter-spacing: 0.08em`     |
| Nav item labels         | 12px  | 500    | `uppercase`  | `letter-spacing: 0.06em`     |
| DSP chip labels         | 11px  | 500    | none         | tight, fits 3-4 chars        |
| Status bar              | 11px  | 400    | none         | Bottom bar, muted text       |
| Channel name            | 13px  | 500    | none         | Bold-ish, truncate with `…`  |
| Gain value / dB         | 12px  | 400    | none         | Right-aligned                |
| Page title              | 13px  | 500    | `uppercase`  | `letter-spacing: 0.1em`      |

**No large headings.** The largest text in the app is 14px. This is a control surface, not a website.

---

## 4. Spacing System

Based on a 4px grid. Use these variables exclusively — no magic pixel values.

| Variable | Value | Use                                   |
|----------|-------|---------------------------------------|
| `--sp-1` | 2px   | Intra-element micro-spacing           |
| `--sp-2` | 4px   | Tight gap (chips row, badge padding)  |
| `--sp-3` | 6px   | Default input padding                 |
| `--sp-4` | 8px   | Row padding, label gap                |
| `--sp-5` | 12px  | Section inner padding                 |
| `--sp-6` | 16px  | Section separation                    |

### Radius

| Variable   | Value | Use                          |
|------------|-------|------------------------------|
| `--r-1`    | 2px   | Default — buttons, chips     |
| `--r-2`    | 3px   | Inputs, modals               |
| `--r-3`    | 4px   | Cards, panels                |
| `--r-full` | 50%   | Dots, status indicators      |

---

## 5. Layout Dimensions

| Variable      | Value  | Use                                              |
|---------------|--------|--------------------------------------------------|
| `--sidebar-w` | 200px  | Sidebar width (defined in shell.css, not base)   |
| `--row-h`     | 64px   | Matrix row height                                |
| `--col-w`     | 44px   | Matrix crosspoint column width                  |
| `--ch-w`      | 240px  | Input channel strip width (mixer)                |
| `--ch-w-out`  | 120px  | Output channel strip width (mixer)               |

---

## 6. Component Patterns

### 6.1 Navigation Sidebar

- **Structure**: `<nav id="sidebar">` containing `.nav-logo`, `<ul>` of `.nav-item[data-route]`,
  and footer with WS status + logout
- **Active state**: `.nav-item.active` gets `--color-accent` left border (3px) and slightly lighter
  background
- **Collapsed**: `body.sidebar-collapsed` collapses to 48px; labels/badges hidden via overflow,
  only icons remain
- **WS status**: `#ws-dot` is a `--r-full` dot: green=connected, amber=connecting, red=disconnected

### 6.2 Channel Strip (Mixer)

A `<div class="channel-strip" data-ch="{id}" data-type="input|output">` contains:

```
.strip-ch-name       — channel name (truncated)
.strip-type-badge    — "L" (local, --color-accent) or "D" (dante, --color-ok)
.strip-vu-canvas     — VuMeter canvas (200px tall typically)
.strip-polarity-btn  — "Ø" toggle
.strip-gain-slider   — input[type=range]
.strip-gain-value    — "+0.0" dB display
.dsp-blocks-row      — grid of .dsp-block-btn chips
.strip-mute-btn      — MUTE — red when active (.mute-active)
.strip-solo-btn      — S — amber when active
.strip-sections-staging — hidden div holding DSP section components
.dsp-modal           — <dialog> opened by chip click
```

**Grouping**: input strips are grouped by stereo pair in `.strip-group` wrappers with a colored
header bar (using `--color-accent` or zone color).

### 6.3 DSP Chip Buttons

```html
<button class="badge" data-dsp="cmp">
  <span class="dsp-block-label">CMP</span>
  <span class="dsp-block-dot">●</span>
</button>
```

- Background: `var(--chip-cmp-bg)` — set via `data-dsp` attribute selector in CSS
- Text: chip-specific color (see color table)
- `.badge.byp` — bypassed: 40% opacity
- `.badge.blk-open` — modal open: `brightness(1.5)` + border

**CSS pattern for chip colors:**
```css
[data-dsp="aec"] { background: var(--chip-aec-bg); color: #c96060; }
[data-dsp="cmp"] { background: var(--chip-cmp-bg); color: #42a055; }
/* etc for all 9 types */
```

### 6.4 Matrix Crosspoints

The matrix is a `<div class="matrix-grid">` with rows for inputs/buses/generators and columns for
outputs.

- **Active crosspoint**: `<div class="xp-cell xp-active">` — filled square, color by source type:
  `--xp-local` (blue) or `--xp-dante` (amber)
- **Inactive crosspoint**: `<div class="xp-cell">` — empty bordered square
- **Hover**: background `--bg-row-hover`
- **Column header**: rotated text, `border-bottom: 2px solid var(--zone-color-N)`

### 6.5 Status Indicators

```html
<span class="status-dot status-dot-ok"></span>   <!-- green -->
<span class="status-dot status-dot-err"></span>  <!-- red -->
<span class="status-dot status-dot-warn"></span> <!-- amber -->
```

Size: 8×8px circle. Always accompanied by text label.

### 6.6 Fader

```html
<input type="range" class="strip-fader" min="-60" max="12" step="0.1" value="0">
```

- Vertical (`writing-mode: vertical-lr; direction: rtl`) in mixer strips
- Horizontal in zone/bus cards
- `accent-color: var(--fader-thumb-sel)` handles thumb color

### 6.7 Buttons

Three variants, all at `min-height: 36px`, `border-radius: var(--r-1)`:

| Class           | Style                                              |
|-----------------|----------------------------------------------------|
| `.btn-accent`   | Transparent bg, accent border/text; fills on hover |
| `.btn-secondary`| Dark bg, muted border; hover lightens bg           |
| `.btn-danger`   | Transparent bg, red border/text; fills on hover    |

**MUTE / SOLO** use separate classes (`.strip-mute-btn`, `.strip-solo-btn`) — they are small
(full strip width, ~28px tall), not the standard button sizing.

### 6.8 Toast Notifications

Fired via: `window.dispatchEvent(new CustomEvent('pb:toast', { detail: { msg, type } }))`

Types: `'info'` (accent), `'error'` (danger), `'ok'` (ok color).

Toasts stack in `#toasts` (bottom-right, fixed position). Auto-dismiss after 4s.

### 6.9 Forms / Inputs

All inputs inherit monospace font and `var(--bg-input)` background.

```css
padding: var(--sp-3) var(--sp-4);   /* 6px 8px */
border: 1px solid var(--border-primary);
border-radius: var(--r-2);
color: var(--text-primary);
```

Labels sit directly above or to the left in a 2-column `kv-grid`:
```css
.system-kv-grid { display: grid; grid-template-columns: 120px 1fr; gap: var(--sp-2) var(--sp-4); }
```

### 6.10 Section Headers

Inside a page or panel, sections are denoted by:
```html
<div class="system-section-header">─ SECTION NAME</div>
```
- 11px, uppercase, `--text-muted`
- Em-dash prefix: `─ ` (U+2500, BOX DRAWINGS LIGHT HORIZONTAL)
- `letter-spacing: 0.08em`
- No background, no border — just typography

### 6.11 Page Layout

Every `init(container)` function writes into `container` which is `#page-container`.

Standard page wrapper:
```html
<div class="[page-name]-page">
  <div class="[page-name]-page-title">[PAGE NAME]</div>
  ...
</div>
```

Page title: 13px, uppercase, `letter-spacing: 0.1em`, `--text-secondary`.

---

## 7. CSS Naming Convention

**Flat BEM-lite**: block and element connected by `-`, no double-underscores, no double-hyphens for
modifiers (use separate class or data attribute instead).

```
.channel-strip          — block
.strip-ch-name          — element within channel-strip
.strip-mute-btn         — element
.mute-active            — modifier class (added dynamically)

.matrix-grid            — block
.xp-cell                — element
.xp-active              — modifier

.dsp-modal              — block
.dsp-modal-title        — element
```

**Page namespacing**: all classes inside a page component are prefixed with the page name:
`.system-section`, `.scenes-card`, `.zones-card`, `.buses-row`, `.dante-ptp-chart`.

**JavaScript-only identifiers**: elements that JS targets by ID use `#kebab-case` IDs. Never target
by class for JS DOM lookups — class is for styling only.

---

## 8. Animation & Motion

Keep motion **functional** — only animate things that change state meaningfully.

| Trigger             | Property           | Duration | Easing           |
|---------------------|--------------------|----------|------------------|
| Sidebar collapse    | width, min-width   | 200ms    | ease             |
| Page transition     | opacity            | 120ms    | ease-in-out      |
| Toast enter/exit    | opacity, transform | 200ms    | ease             |
| WS dot reconnect    | background-color   | instant  | —                |
| Mute button engage  | background-color   | instant  | —                |
| Fader drag          | none               | —        | native range     |

**No**: spinning loaders, bounce effects, parallax, scroll-triggered animations.
`prefers-reduced-motion` must disable all transitions — already handled in base.css.

---

## 9. Do / Don't

| ✅ DO                                               | ❌ DON'T                                         |
|----------------------------------------------------|--------------------------------------------------|
| Use `--color-*` variables exclusively              | Hardcode hex values                              |
| IBM Plex Mono for all text                         | Use any other font                               |
| Uppercase + letter-spacing for section headers     | Use large font sizes for headings                |
| Color to signal state (mute=red, ok=green)         | Use color decoratively                           |
| `--r-1` (2px) border radius on buttons/chips      | Round corners more than `--r-3`                  |
| Dense information layout                           | Add padding/whitespace to "breathe"              |
| `data-dsp` attribute for chip color targeting      | Inline style for chip colors                     |
| `window.dispatchEvent(pb:toast)` for notifications | `alert()` or custom modal for errors             |
| `<dialog>` element for DSP modals                  | Absolutely-positioned overlay divs               |
| Emit cleanup function from `init()`                | Leak event listeners between page navigations    |
| `container.querySelector()` for DOM lookups        | `document.getElementById()` across page scopes  |

---

## 10. File Map

```
web/src/
  index.html                  — SPA shell, single entry point
  css/
    base.css                  — Design tokens (:root), resets, utility classes
    shell.css                 — Sidebar, login overlay, page container layout
    matrix.css                — Matrix grid, crosspoints, row layout
    mixer.css                 — Channel strips, faders, VU meters, groups
    scenes.css                — Scene cards, diff view, A/B compare
    zones.css                 — Zone cards + buses section
    dante.css                 — Dante health, PTP chart, device list
    system.css                — System page, event log, kv-grid
    panels.css                — Shared panel primitives (cards, sections)
  modules/
    router.js                 — Hash-based SPA routing, login lifecycle
    ws.js                     — WebSocket client, reconnect, event bus
    api.js                    — REST client for all backend endpoints
    pages/
      dashboard.js            — Overview, PTP sparkline, status cards
      matrix.js               — Full routing matrix
      inputs.js               — Input channel strips (mixer view)
      outputs.js              — Output channel strips
      buses.js                — Submix bus management
      zones.js                — Zone volume / source control
      scenes.js               — Scene recall / save / A/B compare
      dante.js                — Dante device info, PTP history
      system.js               — Status, event log, config reload
      style-guide.js          — Living design reference (dev only)
    components/
      channel-strip.js        — Full channel strip with DSP modal
      nav-sidebar.js          — Sidebar nav with badge support
      vu-meter.js             — Canvas-based VU meter
      filter-section.js       — HPF/LPF DSP block
      eq-section.js           — Parametric EQ DSP block
      compressor-section.js   — Compressor DSP block
      gate-section.js         — Gate/expander DSP block
      limiter-section.js      — Limiter DSP block
      delay-section.js        — Delay DSP block
      dynamic-eq-section.js   — Dynamic EQ DSP block
      automixer-section.js    — Automixer (AXM) DSP block
      aec-section.js          — AEC DSP block
      afs-section.js          — AFS DSP block
```

---

## 11. Agent Sprint Rules

1. **Read this file before writing any UI code.**
2. **Run `cargo check --workspace` after any Rust changes.** Never break the build.
3. **No `document.getElementById()` inside page modules** — use `container.querySelector()`.
4. **Every `init(container)` must return a cleanup function** — clear timers, remove listeners.
5. **Every API call must have a `.catch()` that fires `pb:toast` with type `'error'`.**
6. **No new CSS variables** — use existing tokens. If a new token is genuinely needed, add it to
   `base.css :root {}` with a comment explaining its purpose.
7. **No `!important`** except in `[hidden] { display: none !important }` (router requirement).
8. **New components follow**: `constructor(el, ch, type)` + `setState(data)` + `destroy()`.
9. **No inline styles** — CSS classes only.
10. **New pages**: create `modules/pages/{name}.js`, add route to `router.js`, add nav item to
    `index.html`, add CSS section to appropriate CSS file.

---

## 11. WebSocket Metering Protocol

### Connection

WebSocket endpoint: `ws://{host}/ws/meters`  
Authentication: include `Authorization: Bearer {token}` header at upgrade, OR pass token
as query param `?token={jwt}` (for browser EventSource compatibility).

### Frame Format (server → client)

All frames are JSON text messages. The server emits one frame per audio buffer
(typically every 10–20 ms at 48 kHz):

```json
{
  "rx_rms":      [-18.3, -24.1, ...],   // dBFS, one per input channel
  "rx_peak":     [-12.0, -18.5, ...],   // dBFS true-peak, one per input
  "rx_gr_db":    [0.0, 0.0, ...],       // gain reduction dB (compressor/gate/ducker), one per input
  "rx_gate_open":[true, false, ...],    // gate state, one per input

  "tx_rms":      [-20.0, -15.5, ...],   // dBFS, one per output zone
  "tx_peak":     [-14.0, -10.0, ...],   // dBFS true-peak, one per output
  "tx_gr_db":    [0.0, 2.1, ...],       // gain reduction dB, one per output (compressor/limiter)
  "tx_clip":     [false, false, ...],   // clip flag (cleared after 500 ms), one per output

  "lufs": {                              // present only when LUFS is enabled
    "momentary":   [-23.1, -18.5, ...], // LUFS-M, one per output
    "short_term":  [-22.8, -19.0, ...], // LUFS-S, one per output
    "integrated":  [-23.0, -20.2, ...]  // LUFS-I since last reset, one per output
  }
}
```

Arrays are indexed by channel number (0-based). Missing or null values indicate
the channel has no DSP or metering is not yet initialised.

### LUFS Frame Details

LUFS values use EBU R128 definitions:
- **Momentary** (M): 400 ms integration window
- **Short-term** (S): 3-second integration window  
- **Integrated** (I): gated integrated loudness since last `POST /api/v1/outputs/{ch}/lufs/reset`

LUFS is only included in WS frames when `OutputDspConfig.lufs_enabled = true` for at
least one output. When no outputs have LUFS enabled, the `"lufs"` key is omitted entirely.

### LUFS API Endpoints

```
GET  /api/v1/outputs/{ch}/lufs
     → { "momentary_lufs": f64, "short_term_lufs": f64, "integrated_lufs": f64 }

POST /api/v1/outputs/{ch}/lufs/reset
     → 204 No Content — resets the integrated loudness accumulator
```

### Client Consumption

The `ws.js` module dispatches a `pb:meters` CustomEvent on `document` with the
parsed frame as `event.detail`. Page modules subscribe:

```js
document.addEventListener('pb:meters', (evt) => {
  const { rx_rms, tx_rms, tx_gr_db, lufs } = evt.detail;
  // update VU meters, GR indicators, LUFS readouts
});
```

LUFS readout in the DSP panel updates from the `lufs` field in WS frames.
Reset button calls `POST /api/v1/outputs/{ch}/lufs/reset` and resets the displayed value.

### GR Indicator Protocol

`tx_gr_db[i]` is the current gain reduction in dB for output zone `i` (positive = reduction).
`rx_gr_db[i]` is the same for input channels (from input-side compressor/gate).

The `DynamicsCanvas.setGrIndicator(gr_db)` method is called on each WS frame with
the matching channel's GR value. The indicator is hidden when `gr_db <= 0.1`.
