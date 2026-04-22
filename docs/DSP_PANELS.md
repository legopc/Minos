# Minos DSP Panel Specification

**Read this document before touching any DSP section component.**  
Also read `docs/DESIGN.md` for global design rules.

---

## 1. Architecture Rules

### Component contract
Every DSP section module must export exactly one class implementing:

```js
class XyzSection {
  constructor(el, ch, type)  // el=container div, ch=channel index (0-based), type='input'|'output'
  setState(data)             // apply server state to DOM (never re-render)
  destroy()                  // remove all event listeners, clear innerHTML
}
```

- Use `this.el` (never `this.containerEl`).
- Use `el.querySelector(…)` (never `document.getElementById`). No `id=` attributes.
- Single-render: `_render()` builds HTML once in constructor. `setState` only patches values.
- Optimistic update: apply state change to UI first, then call API, roll back on error.
- Errors: dispatch `pb:toast` custom event with `{ msg, type:'error' }`.
- API: import only what you need from `/modules/api.js` — `inputDsp`, `outputDsp`, `apiErrorMessage`.
- Shared canvas utilities: import from `/modules/components/dsp-canvas.js`.

### DOM structure (all panels)
```html
<div class="dsp-section" data-section="<name>">
  <div class="dsp-section-hd">
    <span class="dsp-section-name">TITLE</span>
    <!-- optional: enable checkbox label -->
    <label class="dsp-inline-toggle" onclick="event.stopPropagation()">
      <input type="checkbox" class="<name>-enable-cb"> Enable
    </label>
  </div>
  <div class="dsp-section-bd">
    <!-- panel content -->
  </div>
</div>
```

The panel starts **expanded** (no `collapsed` class). It is shown in a `<dialog>` modal managed by
`channel-strip.js`. Sections are never collapsed by default when opened.

---

## 2. Shared Utilities (`dsp-canvas.js`)

Import path: `/modules/components/dsp-canvas.js`

### Exports

| Symbol | Purpose |
|--------|---------|
| `SAMPLE_RATE` | 48000 |
| `FREQ_POINTS` | Float32Array(300) log-spaced 20–20000 Hz |
| `BAND_COLORS` | `['#58a6ff','#3fb950','#d29922','#f85149','#8957e5']` — bands 1–5 |
| `coeffsPeaking(freq, gain_db, q)` | Biquad coefficients |
| `coeffsLowShelf(freq, gain_db, q)` | Biquad coefficients |
| `coeffsHighShelf(freq, gain_db, q)` | Biquad coefficients |
| `coeffsNotch(freq, q)` | Biquad coefficients |
| `coeffsLowPass(freq, q)` | Biquad coefficients |
| `coeffsHighPass(freq, q)` | Biquad coefficients |
| `bandCoeffs(band)` | Dispatch on `band.band_type` |
| `magSquared(c, freq)` | `|H(e^jω)|²` from normalized biquad |
| `computeCurveDb(bands)` | Float32Array(300) dB values; bypassed bands excluded |
| `class FreqCanvas` | SVG frequency response canvas (EQ, DEQ) |
| `class FilterCanvas` | SVG HPF/LPF Butterworth curves |
| `class DynamicsCanvas` | SVG transfer function (compressor, gate, limiter) |

### `FreqCanvas` usage

```js
import { FreqCanvas, BAND_COLORS, computeCurveDb } from '/modules/components/dsp-canvas.js';

// 1. Create: pass the <svg> element and options
const fc = new FreqCanvas(svgEl, { W: 600, H: 200, minDb: -24, maxDb: 24 });
fc.buildGrid(); // call once after construction

// 2. Draw curve:
const dbValues = computeCurveDb(this.state.bands);
fc.updateCurve(dbValues);

// 3. Add draggable handles:
const hEl = fc.addHandle(bandIdx, freq_hz, gain_db, BAND_COLORS[bandIdx], String(bandIdx + 1));

// 4. Wire drag on the returned handle group element:
const cleanup = fc.startHandleDrag(hEl, (freq, db) => {
  // onMove: update state + DOM (no API call)
  this._onHandleMove(bandIdx, freq, db);
}, (freq, db) => {
  // onCommit: call API
  this._commitBand(bandIdx);
});
this._dragCleanups.push(cleanup);

// 5. Update handle after param change:
fc.moveHandle(bandIdx, newFreq, newDb, isBypassed);

// 6. Cleanup:
this._dragCleanups.forEach(fn => fn());
```

### `FilterCanvas` usage

```js
import { FilterCanvas } from '/modules/components/dsp-canvas.js';

const fc = new FilterCanvas(svgEl, { W: 600, H: 140 });
fc.buildGrid();

// Update curves:
fc.updateHpf({ enabled: true, freq_hz: 80, order: 2 });  // order=1..4
fc.updateLpf({ enabled: false, freq_hz: 18000, order: 2 });

// Wire drag (returns cleanup fn):
const cleanHpf = fc.startHpfDrag(
  (freq) => this._onHpfMove(freq),     // live update during drag
  (freq) => this._commitHpf(freq),     // API call on release
);
const cleanLpf = fc.startLpfDrag(
  (freq) => this._onLpfMove(freq),
  (freq) => this._commitLpf(freq),
);
```

`order` maps to slope: `1=6dB/oct  2=12dB/oct  3=18dB/oct  4=24dB/oct`

### `DynamicsCanvas` usage

```js
import { DynamicsCanvas } from '/modules/components/dsp-canvas.js';

const dc = new DynamicsCanvas(svgEl, { W: 200, H: 200, minDb: -80, maxDb: 0 });
dc.buildGrid();

// Draw curve (call after any param change):
dc.drawCompressorCurve(threshold_db, ratio, knee_db);
// or:
dc.drawGateCurve(threshold_db, ratio, range_db);
// or:
dc.drawLimiterCurve(threshold_db);

// Wire threshold drag:
const cleanup = dc.startThresholdDrag(
  (db) => { this.state.threshold_db = db; /* update input field */ this._redraw(); },
  (db) => this._commitThreshold(db),
);

// Gain reduction indicator (optional, driven by WS meters):
dc.setGrIndicator(gr_db); // 0 = hide
```

---

## 3. Stepper Buttons

All numeric params in DSP panels use stepper buttons (Extron-style). The pattern:

```html
<div class="dsp-param-row">
  <span class="dsp-param-label">Thr</span>
  <div class="dsp-stepper">
    <button class="dsp-stepper-dec" data-param="threshold_db" data-step="-1">−</button>
    <input type="number" class="dsp-stepper-inp" data-param="threshold_db"
           min="-80" max="0" step="1" value="-20">
    <button class="dsp-stepper-inc" data-param="threshold_db" data-step="1">+</button>
    <span class="dsp-param-unit">dB</span>
  </div>
</div>
```

Attach a single delegated listener on the `.dsp-section-bd` for `click` events on
`.dsp-stepper-dec` and `.dsp-stepper-inc`:

```js
this._clickHandler = (e) => {
  const btn = e.target.closest('.dsp-stepper-dec, .dsp-stepper-inc');
  if (!btn) return;
  const param = btn.dataset.param;
  const step  = parseFloat(btn.dataset.step);
  const inp   = this.el.querySelector(`[data-param="${param}"].dsp-stepper-inp`);
  const prev  = parseFloat(inp.value);
  inp.value = Math.max(inp.min, Math.min(inp.max, prev + step));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
};
this.el.querySelector('.dsp-section-bd').addEventListener('click', this._clickHandler);
```

Remove in `destroy()`.

---

## 4. EqSection (`eq-section.js`)

**Input + Output.** 5-band parametric EQ.

### State shape
```json
{
  "enabled": true,
  "bands": [
    { "band_type": "LowShelf",  "freq_hz": 100,   "gain_db": 0.0, "q": 0.707, "bypassed": false },
    { "band_type": "Peaking",   "freq_hz": 250,   "gain_db": 0.0, "q": 1.0,   "bypassed": false },
    { "band_type": "Peaking",   "freq_hz": 1000,  "gain_db": 0.0, "q": 1.0,   "bypassed": false },
    { "band_type": "Peaking",   "freq_hz": 4000,  "gain_db": 0.0, "q": 1.0,   "bypassed": false },
    { "band_type": "HighShelf", "freq_hz": 10000, "gain_db": 0.0, "q": 0.707, "bypassed": false }
  ]
}
```

`band_type` values: `LowShelf | Peaking | HighShelf | Notch | LowPass | HighPass`

### Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│  EQ    [✓] Enable                                                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   +24──────────────────────────────────────────────────────────────  │
│   +12──────────────────────────────────────────────────────────────  │
│     0  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│   -12──────────────────────────────────────────────────────────────  │
│   -24──────────────────────────────────────────────────────────────  │
│          100        1k           10k                                 │
│                                                                      │
│  ① [Lo Shelf ▼] [−]  100[+]Hz  [−]  0.0[+]dB  [−] 0.7[+]Q  [BYP] │
│  ② [Peak    ▼] [−]  250[+]Hz  [−]  0.0[+]dB  [−] 1.0[+]Q  [BYP] │
│  ③ [Peak    ▼] [−] 1000[+]Hz  [−]  0.0[+]dB  [−] 1.0[+]Q  [BYP] │
│  ④ [Peak    ▼] [−] 4000[+]Hz  [−]  0.0[+]dB  [−] 1.0[+]Q  [BYP] │
│  ⑤ [Hi Shelf▼] [−]10000[+]Hz  [−]  0.0[+]dB  [−] 0.7[+]Q  [BYP] │
│                                                                      │
│   [BYPASS ALL]                              [RESET ALL]             │
└──────────────────────────────────────────────────────────────────────┘
```

### SVG setup
```js
// In _render():
const svg = this.el.querySelector('.dsp-freq-svg');
this._fc = new FreqCanvas(svg, { W: 600, H: 200, minDb: -24, maxDb: 24 });
this._fc.buildGrid();

// Build handles for each band:
for (let i = 0; i < 5; i++) {
  const b = this.state.bands[i];
  const hEl = this._fc.addHandle(i, b.freq_hz, b.gain_db, BAND_COLORS[i], String(i + 1));
  hEl.style.cursor = 'grab';
  const cleanup = this._fc.startHandleDrag(hEl,
    (f, db) => this._onHandleMove(i, f, db),
    (f, db) => this._commitBand(i),
  );
  this._dragCleanups.push(cleanup);
}

this._fc.updateCurve(computeCurveDb(this.state.bands));
```

### HTML for one band row
```html
<div class="dsp-band-row" data-band="0">
  <span class="dsp-band-badge" style="--band-color:#58a6ff">1</span>
  <select class="dsp-band-type-sel">
    <option value="LowShelf">Lo Shelf</option>
    <option value="Peaking" selected>Peak</option>
    <option value="HighShelf">Hi Shelf</option>
    <option value="Notch">Notch</option>
    <option value="LowPass">Lo Pass</option>
    <option value="HighPass">Hi Pass</option>
  </select>
  <div class="dsp-stepper">
    <button class="dsp-stepper-dec" data-param="freq_hz" data-step="-10">−</button>
    <input class="dsp-stepper-inp" type="number" data-param="freq_hz" min="20" max="20000" step="1">
    <button class="dsp-stepper-inc" data-param="freq_hz" data-step="10">+</button>
    <span class="dsp-param-unit">Hz</span>
  </div>
  <div class="dsp-stepper">
    <button class="dsp-stepper-dec" data-param="gain_db" data-step="-0.5">−</button>
    <input class="dsp-stepper-inp" type="number" data-param="gain_db" min="-24" max="24" step="0.5">
    <button class="dsp-stepper-inc" data-param="gain_db" data-step="0.5">+</button>
    <span class="dsp-param-unit">dB</span>
  </div>
  <div class="dsp-stepper">
    <button class="dsp-stepper-dec" data-param="q" data-step="-0.1">−</button>
    <input class="dsp-stepper-inp" type="number" data-param="q" min="0.1" max="10" step="0.1">
    <button class="dsp-stepper-inc" data-param="q" data-step="0.1">+</button>
    <span class="dsp-param-unit">Q</span>
  </div>
  <button class="dsp-band-byp-btn" title="Bypass this band">BYP</button>
</div>
```

`data-band` attribute on the row is used to find the row. Band badge CSS:
`.dsp-band-badge { background: var(--band-color); }` via the inline CSS variable.

### Band type change
When type changes to `LowPass` or `HighPass`, the gain stepper should be disabled (these
filters have no gain parameter — set it to 0 and disable the input).

### `BYPASS ALL` button
Calls `api.setEq(ch, { enabled: false, bands: this.state.bands })`. Visually dims the SVG curve
by toggling `.eq-disabled` on the `<svg>` element.

### `RESET ALL` button
Restores `DEFAULT_BANDS` (kept as a module constant), calls API, re-renders.

### API call
```js
await this._api.setEq(this.ch, { enabled: this.state.enabled, bands: this.state.bands });
```

---

## 5. FilterSection (`filter-section.js`)

**Input + Output.** HPF and LPF with visual frequency response.

### State shape
```json
{
  "hpf": { "enabled": false, "freq_hz": 80,    "slope_db_oct": 12 },
  "lpf": { "enabled": false, "freq_hz": 18000, "slope_db_oct": 12 }
}
```

`slope_db_oct`: `6 | 12 | 18 | 24` → maps to Butterworth order `1 | 2 | 3 | 4`.

### Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│  FILTERS                                                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   0dB ──────────────────────────────────────────────────────────── │
│  -12dB ──────────────────────────────────────────────────────────── │
│  -24dB ──────────────────────────────────────────────────────────── │
│          100             1k              10k                         │
│         (HPF slope on left)           (LPF slope on right)          │
│                                                                      │
│  HPF [✓] [−]  80[+] Hz  Slope [12 dB/oct ▼]                       │
│  LPF [ ] [−]18000[+] Hz  Slope [12 dB/oct ▼]                       │
└──────────────────────────────────────────────────────────────────────┘
```

### SVG setup
```js
this._fc = new FilterCanvas(svgEl, { W: 600, H: 140 });
this._fc.buildGrid();

// Wire cutoff handle drags:
this._hpfDragCleanup = this._fc.startHpfDrag(
  (f) => { this.state.hpf.freq_hz = f; this._updateHpfInput(f); this._fc.updateHpf(this.state.hpf); },
  (f) => this._commitHpf(),
);
this._lpfDragCleanup = this._fc.startLpfDrag(
  (f) => { this.state.lpf.freq_hz = f; this._updateLpfInput(f); this._fc.updateLpf(this.state.lpf); },
  (f) => this._commitLpf(),
);
```

### Slope selector HTML
```html
<select class="dsp-slope-sel" data-filter="hpf">
  <option value="6">6 dB/oct</option>
  <option value="12" selected>12 dB/oct</option>
  <option value="18">18 dB/oct</option>
  <option value="24">24 dB/oct</option>
</select>
```

On slope change: update `state.hpf.slope_db_oct`, update `FilterCanvas` via
`this._fc.updateHpf({ ...this.state.hpf })`, then call API.

`slope_db_oct` → `order` conversion: `order = slope_db_oct / 6`

### API calls
```js
await this._api.setHpf(this.ch, this.state.hpf); // { enabled, freq_hz, slope_db_oct }
await this._api.setLpf(this.ch, this.state.lpf);
```

---

## 6. CompressorSection (`compressor-section.js`)

**Input + Output.**

### State shape
```json
{
  "enabled": false,
  "threshold_db": -20.0,
  "ratio":        4.0,
  "knee_db":      6.0,
  "attack_ms":    10.0,
  "release_ms":   100.0,
  "makeup_db":    0.0
}
```

### Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│  COMP   [✓] Enable                                                  │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐   Thr   [−] -20 [+] dB                   │
│  │  0                  │   Ratio [−]  4.0[+] :1                   │
│  │   ╲ (soft knee)     │   Knee  [−]  6.0[+] dB                   │
│  │    ╲────────────    │   Atk   [−]   10[+] ms                   │
│  │  -40      -20   0   │   Rel   [−]  100[+] ms                   │
│  └─────────────────────┘   MkUp  [−]  0.0[+] dB                   │
└──────────────────────────────────────────────────────────────────────┘
```

Side-by-side layout: SVG graph (200×200) on the left, param list on the right.
Use CSS `.dsp-dynamics-layout` (display: grid, grid-template-columns: 200px 1fr, gap: 12px).

### SVG setup
```js
this._dc = new DynamicsCanvas(svgEl, { W: 200, H: 200, minDb: -80, maxDb: 0 });
this._dc.buildGrid();
this._dc.drawCompressorCurve(this.state.threshold_db, this.state.ratio, this.state.knee_db);

// Wire threshold drag:
this._thrDragCleanup = this._dc.startThresholdDrag(
  (db) => {
    this.state.threshold_db = db;
    this.el.querySelector('[data-param="threshold_db"].dsp-stepper-inp').value = db.toFixed(1);
    this._dc.drawCompressorCurve(db, this.state.ratio, this.state.knee_db);
  },
  (_db) => this._commitAll(),
);
```

### `_redraw()` helper
Call `_dc.drawCompressorCurve(…)` whenever any param changes.

### API
```js
await this._api.setCompressor(this.ch, this.state);
```

---

## 7. GateSection (`gate-section.js`)

**Input only.**

### State shape
```json
{
  "enabled":      false,
  "threshold_db": -40.0,
  "ratio":         4.0,
  "attack_ms":     5.0,
  "hold_ms":      50.0,
  "release_ms":  100.0,
  "range_db":     80.0
}
```

### Layout — same side-by-side pattern as Compressor
SVG left (200×200), params right.

Gate transfer function: above threshold = unity, below = expanded/gated with `range_db` floor.
`drawGateCurve(threshold_db, ratio, range_db)` — `ratio` here is the expansion ratio (1=unity, >1=expansion).
Note: `ratio` in the gate state means expansion ratio. A ratio of 4 means signal drops 4× faster than input below threshold.

### API
```js
await inputDsp.setGate(this.ch, this.state);
```

---

## 8. LimiterSection (`limiter-section.js`)

**Output only.**

### State shape
```json
{
  "enabled":       false,
  "threshold_db":  -3.0,
  "lookahead_ms":   1.0,
  "release_ms":    50.0
}
```

### Layout — same side-by-side pattern
SVG left (200×160), params right.

Limiter transfer: unity until threshold, then brick wall ceiling. Very simple graph.
Use `drawLimiterCurve(threshold_db)`.

Threshold range: −20 to 0 dBFS.

### API
```js
await outputDsp.setLimiter(this.ch, this.state);
```

---

## 9. DelaySection (`delay-section.js`)

**Output only.** No visualization needed — use a large slider + distance display.

### State shape
```json
{
  "enabled":   false,
  "delay_ms":  0.0
}
```

### Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│  DELAY   [✓] Enable                                                 │
├──────────────────────────────────────────────────────────────────────┤
│  0ms ════════════════◆═══════════════════════════════════ 500ms     │
│                                                                      │
│  [−]  0.0  [+] ms   (step 0.1ms)                                   │
│                                                                      │
│  ≈ 0.0 m at 344 m/s   ·   0 samples @ 48 kHz                       │
└──────────────────────────────────────────────────────────────────────┘
```

Distance: `meters = delay_ms / 1000 * 344`  
Samples: `samples = Math.round(delay_ms / 1000 * 48000)`

Slider and stepper input stay in sync (bidirectional).

### HTML for range slider
```html
<div class="dsp-delay-slider-wrap">
  <input type="range" class="dly-range" min="0" max="500" step="0.1" value="0">
</div>
<div class="dsp-param-row">
  <div class="dsp-stepper">
    <button class="dsp-stepper-dec" data-param="delay_ms" data-step="-0.1">−</button>
    <input class="dsp-stepper-inp" type="number" data-param="delay_ms" min="0" max="500" step="0.1">
    <button class="dsp-stepper-inc" data-param="delay_ms" data-step="0.1">+</button>
    <span class="dsp-param-unit">ms</span>
  </div>
</div>
<div class="dsp-delay-info">
  <span class="dly-meters-disp">≈ 0.0 m at 344 m/s</span>
  <span class="dly-samples-disp">0 samples @ 48 kHz</span>
</div>
```

Slider `input` event syncs to stepper; stepper `change` event syncs to slider. Both call API on `change`.

### API
```js
await outputDsp.setDelay(this.ch, { enabled: this.state.enabled, delay_ms: this.state.delay_ms });
```

---

## 10. DynamicEqSection (`dynamic-eq-section.js`)

**Input + Output.** Like EQ but each band has an additional sidechain threshold — the gain is applied only when the signal level exceeds `threshold_db`.

### State shape
```json
{
  "enabled": false,
  "bands": [
    {
      "band_type":   "Peaking",
      "freq_hz":     1000,
      "gain_db":     -6.0,
      "q":           1.0,
      "threshold_db": -20.0,
      "ratio":        4.0,
      "attack_ms":    10.0,
      "release_ms":   100.0,
      "bypassed":     false
    }
  ]
}
```

### Layout
Same as EqSection but each band row has two additional rows for dynamic parameters:

```
┌──────────────────────────────────────────────────────────────────────┐
│  DYN EQ   [✓] Enable                                                │
├──────────────────────────────────────────────────────────────────────┤
│  [SVG frequency response — same as EqSection]                        │
│                                                                      │
│  ① [Peak▼] [−]1000[+]Hz [−]-6.0[+]dB [−]1.0[+]Q          [BYP]  │
│     Dyn: Thr[−]-20[+]dB  Ratio[−]4[+]:1  Atk[−]10[+]ms Rel[−]100[+]ms │
│  ② ...                                                              │
└──────────────────────────────────────────────────────────────────────┘
```

SVG canvas shows the static EQ response. A subtle shaded horizontal region per band can indicate
the threshold level (this is optional for scaffold — implement if clean, skip if complex).

Use exactly the same `FreqCanvas`, `computeCurveDb`, `BAND_COLORS`, and band handle drag pattern
as `EqSection`. The code structure should mirror EqSection as closely as possible.

### API
```js
await this._api.setDeq(this.ch, this.state);
```

---

## 11. AutomixerSection (`automixer-section.js`)

**Input only.** No graph needed. Current implementation is adequate.

Minor improvement: add a group slot visualizer — 8 small squares (groups 0–7) with the current
group highlighted. Update on group input change.

```html
<div class="axm-group-grid">
  <span class="axm-slot" data-slot="0"></span>
  <!-- ... slots 1–7 -->
</div>
```

On group change, toggle `.axm-slot--active` on the matching slot.

### State shape (unchanged)
```json
{ "enabled": false, "group": 0, "priority": 0, "last_mic_hold_ms": 0 }
```

---

## 12. AecSection (`aec-section.js`)

**Input only.** No graph needed. Current implementation is adequate as-is.

State shape (unchanged):
```json
{ "enabled": false, "tail_ms": 128, "nlp_level": "moderate", "comfort_noise": true }
```

---

## 13. AfsSection (`afs-section.js`)

**Input only.** Current implementation is adequate as-is.

State shape (unchanged):
```json
{ "enabled": false, "fixed_filters": 4, "dynamic_filters": 8, "sensitivity_db": -6 }
```

---

## 14. CSS Class Reference

All DSP panel classes are in `web/src/css/panels.css`.

### Section structure
| Class | Element |
|-------|---------|
| `.dsp-section` | Outer container of each section (`data-section="<name>"`) |
| `.dsp-section-hd` | Section title bar (not collapsible by default) |
| `.dsp-section-name` | Title text (uppercase, monospace) |
| `.dsp-inline-toggle` | Enable checkbox label inside title bar |
| `.dsp-section-bd` | Section body — all content lives here |
| `.dsp-section-footer` | Footer bar with action buttons (BYPASS ALL, RESET) |

### Canvas containers
| Class | Element |
|-------|---------|
| `.dsp-freq-svg` | `<svg>` for FreqCanvas (EQ, DEQ) — width 100%, height 200px |
| `.dsp-filter-svg` | `<svg>` for FilterCanvas — width 100%, height 140px |
| `.dsp-dynamics-svg` | `<svg>` for DynamicsCanvas — 200px × 200px fixed |
| `.dsp-dynamics-layout` | Grid wrapper: `200px 1fr`, holds SVG + param list side-by-side |

### FreqCanvas SVG classes
| Class | Purpose |
|-------|---------|
| `.fc-grid` | Grid lines (subtle, dashed) |
| `.fc-zero` | 0 dB reference line |
| `.fc-curve` | Response polyline (accent color, stroke-width 2) |
| `.fc-label` | Axis labels (small, dim) |
| `.fc-label-db` | dB labels on left edge |
| `.fc-label-hz` | Frequency labels on bottom edge |
| `.fc-handle` | Band handle group (`<g>`) |
| `.fc-handle-circle` | Handle circle (cursor grab, stroke = band color) |
| `.fc-handle-label` | Band number text centered in handle |
| `.fc-handle--bypassed` | Dim state when band bypassed (opacity 0.3) |

### FilterCanvas SVG classes
| Class | Purpose |
|-------|---------|
| `.flt-hpf-curve` | HPF Butterworth curve (warm yellow `#d29922`) |
| `.flt-lpf-curve` | LPF Butterworth curve (blue `#58a6ff`) |
| `.flt-handle` | Cutoff handle circle at −3 dB point |
| `.flt-hpf-handle` | HPF handle (yellow, cursor ew-resize) |
| `.flt-lpf-handle` | LPF handle (blue, cursor ew-resize) |
| `.flt-curve--disabled` | Disabled state: opacity 0.25, dashed |

### DynamicsCanvas SVG classes
| Class | Purpose |
|-------|---------|
| `.dc-grid` | Grid lines |
| `.dc-unity` | 1:1 unity line (dashed) |
| `.dc-curve` | Transfer curve (accent color) |
| `.dc-thr-line` | Vertical threshold reference line (yellow, dashed) |
| `.dc-thr-handle` | Diamond handle at threshold on unity line (`#d29922`, ew-resize) |
| `.dc-gr-line` | Gain reduction indicator (red, hidden when GR=0) |
| `.dc-label` | Axis labels |

### Param rows
| Class | Purpose |
|-------|---------|
| `.dsp-param-row` | One parameter row (display: flex, align-items: center) |
| `.dsp-param-label` | Left label (5ch wide, uppercase) |
| `.dsp-stepper` | +/- stepper container (flex row) |
| `.dsp-stepper-dec` | `−` button |
| `.dsp-stepper-inc` | `+` button |
| `.dsp-stepper-inp` | Number input inside stepper |
| `.dsp-param-unit` | Unit label (dB, Hz, ms, etc.) |

### Band rows (EQ / DEQ)
| Class | Purpose |
|-------|---------|
| `.dsp-band-row` | One band row (grid layout) |
| `.dsp-band-badge` | Colored circle with band number (uses `--band-color` CSS var) |
| `.dsp-band-type-sel` | Filter type `<select>` |
| `.dsp-band-byp-btn` | Per-band bypass button (`.active` = bypassed) |

---

## 15. Common Bugs to Avoid

1. **Never use `id=` attributes** inside section components. IDs are global and break when multiple
   strips are open. Always use `this.el.querySelector(…)`.
2. **Destroy cleanup**: every listener added in `_render()` or anywhere else must be removed in
   `destroy()`. Store bound handler references on `this`.
3. **setState vs re-render**: `setState(data)` must patch existing DOM values — never call
   `this.el.innerHTML = …` inside `setState`. Re-rendering clears SVG handles and drag listeners.
4. **Drag cleanup array**: collect all `startHandleDrag` / `startThresholdDrag` cleanup functions
   into `this._dragCleanups = []`. In `destroy()`, call each: `this._dragCleanups.forEach(f => f())`.
5. **Bypassed bands**: `computeCurveDb` reads `band.bypassed`. When a band is bypassed, update
   `this.state.bands[i].bypassed = true` and call `computeCurveDb` + `updateCurve`. Do **not** set
   `gain_db` to zero — the stored gain is preserved and restored when bypass is removed.
6. **SVG pointer events on `<g>` elements**: for `setPointerCapture` to work, the `<g>` must have
   `pointer-events: all` set in CSS (see `panels.css`). The inner `<circle>` should have
   `pointer-events: none` so click events bubble to the `<g>`.
7. **Handle `q` when band type changes to LowPass/HighPass**: if `q` is undefined for the new
   type, default to `0.707` (Butterworth maximally flat).
8. **Frequency step for stepper buttons**: Hz steppers should use context-aware steps:
   - Below 200 Hz: step 5 Hz
   - 200–2000 Hz: step 50 Hz
   - Above 2000 Hz: step 100 Hz
   Implement this by computing step dynamically in the `+` / `−` click handler.

---

## 14. DuckerSection (`ducker-section.js`)

Sidechain volume ducker. Ducks the output channel's level when a nominated sidechain source (input channel) rises above a threshold.

### API shape (from `OutputDspConfig.ducker`)

```json
{
  "enabled": true,
  "bypassed": false,
  "threshold_db": -20.0,
  "ratio": 4.0,
  "attack_ms": 10.0,
  "release_ms": 150.0,
  "range_db": -30.0,
  "sidechain_source_id": "rx_0"
}
```

### Constructor

```js
new DuckerSection(hostEl, channelId, opts)
// opts.onChange(block, params) — block = 'ducker'
// opts.onBypass(block, bypassed)
// opts.accentColor — CSS color string
```

### Controls

| Control | Type | Range | Default |
|---------|------|-------|---------|
| Threshold | Slider | −60 to 0 dB | −20 dB |
| Ratio | Stepper | 1.0–20.0 ×1 step | 4.0 |
| Attack | Slider (log) | 0.5–200 ms | 10 ms |
| Release | Slider (log) | 5–2000 ms | 150 ms |
| Range | Slider | −60 to 0 dB | −30 dB |
| Sidechain | Select | populated from input channel list | — |

### Sidechain Picker

The `<select>` element is populated from the API at init time:

```js
// Fetch input channel names
const config = await fetch('/api/v1/config').then(r => r.json());
const inputs = config.inputs ?? [];
// Render <option value="rx_0">IN 1</option> … for each input
```

`onChange` fires with the full updated params object when any control changes.

### GR Indicator

`DuckerSection` does **not** render a `DynamicsCanvas`. Instead it shows a compact horizontal GR bar below the controls:

```html
<div class="ducker-gr-wrap">
  <div class="ducker-gr-label">GR</div>
  <div class="ducker-gr-bar-outer">
    <div class="ducker-gr-bar-inner" style="width: 0%"></div>
  </div>
  <div class="ducker-gr-value">0.0 dB</div>
</div>
```

Update via `setGrIndicator(gr_db)` — maps −30 dB = 100% bar width, 0 = 0%.

### setState

```js
setState({ threshold_db, ratio, attack_ms, release_ms, range_db, sidechain_source_id, bypassed, enabled })
```

Updates all control values without re-rendering the container. Triggers `_updateBypassVisual()`.
