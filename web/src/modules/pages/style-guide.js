/**
 * Minos Design System — Living Style Guide
 * Accessible at #/style-guide (dev only, no nav item)
 * Reference for all design tokens, components, and states.
 */

export async function init(container) {
  container.innerHTML = `
<style>
.style-guide-page {
  padding: 24px;
  max-width: 1200px;
  color: var(--text-primary);
  font-family: 'IBM Plex Mono', 'Consolas', 'SF Mono', monospace;
  font-size: 13px;
}
.sg-section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin: 24px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 6px;
}
.sg-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}
.sg-group-label {
  font-size: 10px;
  color: var(--text-dim);
  margin: 12px 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  width: 100%;
}
/* Swatches */
.sg-swatch {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.sg-swatch-box {
  width: 80px;
  height: 40px;
  border-radius: var(--r-1);
  border: 1px solid var(--border-subtle);
}
.sg-swatch-name {
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.2;
}
.sg-swatch-hex {
  font-size: 10px;
  color: var(--text-dim);
}
/* Typography samples */
.sg-type-row {
  padding: 6px 0;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.sg-type-label {
  font-size: 10px;
  color: var(--text-dim);
  min-width: 120px;
  flex-shrink: 0;
}
/* DSP chip states */
.sg-chip-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sg-chip-state-label {
  font-size: 10px;
  color: var(--text-dim);
  min-width: 80px;
}
/* Status dots */
.sg-indicator-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}
/* Zone bars */
.sg-zone-bar {
  padding: 6px 10px;
  border-radius: var(--r-1);
  background: var(--bg-surface);
  font-size: 11px;
  border-left: 3px solid;
  min-width: 100px;
}
/* XP matrix */
.sg-xp-grid {
  display: grid;
  grid-template-columns: repeat(3, var(--col-w));
  gap: 0;
  border: 1px solid var(--border-primary);
  border-radius: var(--r-1);
  overflow: hidden;
}
.sg-xp-cell {
  width: var(--col-w);
  height: var(--row-h);
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}
.sg-xp-cell:nth-child(3n) { border-right: none; }
.sg-xp-cell:nth-last-child(-n+3) { border-bottom: none; }
.sg-xp-dot {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: transparent;
  border: 1px solid var(--border-primary);
}
.sg-xp-dot.local {
  background: var(--xp-local);
  border-color: var(--xp-local);
  box-shadow: 0 0 10px 2px var(--xp-local);
}
.sg-xp-dot.dante {
  background: var(--xp-dante);
  border-color: var(--xp-dante);
  box-shadow: 0 0 10px 2px var(--xp-dante);
}
/* Section accent bars */
.sg-section-bar {
  padding: 6px 10px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-left: 3px solid;
  background: var(--bg-surface);
  border-radius: var(--r-1);
  min-width: 120px;
}
/* Generator badges */
.sg-gen-badge {
  font-size: 10px;
  border-radius: var(--r-1);
  border: 1px solid;
  padding: 2px 6px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
/* Toast examples */
.sg-toast {
  background: var(--bg-surface);
  border-left: 3px solid var(--text-secondary);
  color: var(--text-secondary);
  padding: 10px 12px;
  border-radius: var(--r-1);
  font-size: 11px;
  max-width: 320px;
}
.sg-toast-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 2px;
  opacity: 0.7;
}
</style>

<div class="style-guide-page">

  <div style="margin-bottom:16px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);">Minos Design System</div>
    <div style="font-size:18px;color:var(--text-primary);margin-top:4px;">Living Style Guide</div>
    <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Dev reference — not linked in nav. Accessible at <span style="color:var(--text-accent)">#/style-guide</span></div>
  </div>

  <!-- ── 1. Color Palette ─────────────────────────────────────────────── -->
  <h2 class="sg-section-title">1 · Color Palette</h2>

  <div class="sg-group-label">Backgrounds</div>
  <div class="sg-row">
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#13151c"></div><div class="sg-swatch-name">--bg-dark</div><div class="sg-swatch-hex">#13151c</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#1a1d24"></div><div class="sg-swatch-name">--bg-workspace</div><div class="sg-swatch-hex">#1a1d24</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#1e2230"></div><div class="sg-swatch-name">--bg-surface</div><div class="sg-swatch-hex">#1e2230</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#0f1117"></div><div class="sg-swatch-name">--bg-input</div><div class="sg-swatch-hex">#0f1117</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#1f2330"></div><div class="sg-swatch-name">--bg-row-hover</div><div class="sg-swatch-hex">#1f2330</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#1e2740"></div><div class="sg-swatch-name">--bg-row-sel</div><div class="sg-swatch-hex">#1e2740</div></div>
  </div>

  <div class="sg-group-label">Borders</div>
  <div class="sg-row">
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#2d3140"></div><div class="sg-swatch-name">--border-primary</div><div class="sg-swatch-hex">#2d3140</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#1a1d2a"></div><div class="sg-swatch-name">--border-subtle</div><div class="sg-swatch-hex">#1a1d2a</div></div>
  </div>

  <div class="sg-group-label">Text</div>
  <div class="sg-row">
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#e6edf3"></div><div class="sg-swatch-name">--text-primary</div><div class="sg-swatch-hex">#e6edf3</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#c9d1d9"></div><div class="sg-swatch-name">--text-secondary</div><div class="sg-swatch-hex">#c9d1d9</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#8b949e"></div><div class="sg-swatch-name">--text-muted</div><div class="sg-swatch-hex">#8b949e</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#484f58"></div><div class="sg-swatch-name">--text-dim</div><div class="sg-swatch-hex">#484f58</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#58a6ff"></div><div class="sg-swatch-name">--text-accent</div><div class="sg-swatch-hex">#58a6ff</div></div>
  </div>

  <div class="sg-group-label">Semantic / Status</div>
  <div class="sg-row">
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#58a6ff"></div><div class="sg-swatch-name">--color-accent</div><div class="sg-swatch-hex">#58a6ff</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#3fb950"></div><div class="sg-swatch-name">--color-ok</div><div class="sg-swatch-hex">#3fb950</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#d29922"></div><div class="sg-swatch-name">--color-warn</div><div class="sg-swatch-hex">#d29922</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#f85149"></div><div class="sg-swatch-name">--color-danger</div><div class="sg-swatch-hex">#f85149</div></div>
  </div>

  <div class="sg-group-label">Status Dots</div>
  <div class="sg-row">
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#3fb950"></div><div class="sg-swatch-name">--dot-live</div><div class="sg-swatch-hex">#3fb950</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#484f58"></div><div class="sg-swatch-name">--dot-offline</div><div class="sg-swatch-hex">#484f58</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#f85149"></div><div class="sg-swatch-name">--dot-error</div><div class="sg-swatch-hex">#f85149</div></div>
  </div>

  <div class="sg-group-label">VU Meter</div>
  <div class="sg-row">
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#3fb950"></div><div class="sg-swatch-name">--vu-green</div><div class="sg-swatch-hex">#3fb950</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#d29922"></div><div class="sg-swatch-name">--vu-amber</div><div class="sg-swatch-hex">#d29922</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#f85149"></div><div class="sg-swatch-name">--vu-red</div><div class="sg-swatch-hex">#f85149</div></div>
  </div>

  <div class="sg-group-label">Zone Palette</div>
  <div class="sg-row">
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#58a6ff"></div><div class="sg-swatch-name">--zone-color-0</div><div class="sg-swatch-hex">#58a6ff</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#3fb950"></div><div class="sg-swatch-name">--zone-color-1</div><div class="sg-swatch-hex">#3fb950</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#d29922"></div><div class="sg-swatch-name">--zone-color-2</div><div class="sg-swatch-hex">#d29922</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#c678dd"></div><div class="sg-swatch-name">--zone-color-3</div><div class="sg-swatch-hex">#c678dd</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#f0883e"></div><div class="sg-swatch-name">--zone-color-4</div><div class="sg-swatch-hex">#f0883e</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#85c46a"></div><div class="sg-swatch-name">--zone-color-5</div><div class="sg-swatch-hex">#85c46a</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#ff7b72"></div><div class="sg-swatch-name">--zone-color-6</div><div class="sg-swatch-hex">#ff7b72</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#79c0ff"></div><div class="sg-swatch-name">--zone-color-7</div><div class="sg-swatch-hex">#79c0ff</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#56d364"></div><div class="sg-swatch-name">--zone-color-8</div><div class="sg-swatch-hex">#56d364</div></div>
    <div class="sg-swatch"><div class="sg-swatch-box" style="background:#e3b341"></div><div class="sg-swatch-name">--zone-color-9</div><div class="sg-swatch-hex">#e3b341</div></div>
  </div>

  <!-- ── 2. Typography ────────────────────────────────────────────────── -->
  <h2 class="sg-section-title">2 · Typography</h2>

  <div>
    <div class="sg-type-row">
      <span class="sg-type-label">body / 13px primary</span>
      <span style="color:var(--text-primary);font-size:13px;">Channel Name — IR-1</span>
    </div>
    <div class="sg-type-row">
      <span class="sg-type-label">section header / 11px</span>
      <span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">─ BUSES</span>
    </div>
    <div class="sg-type-row">
      <span class="sg-type-label">nav label / 12px</span>
      <span style="color:var(--text-primary);font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">MATRIX</span>
    </div>
    <div class="sg-type-row">
      <span class="sg-type-label">DSP chip / 11px</span>
      <span style="font-size:11px;font-weight:500;letter-spacing:0.04em;color:var(--text-secondary);">AEC</span>
    </div>
    <div class="sg-type-row">
      <span class="sg-type-label">muted / text-muted</span>
      <span style="color:var(--text-muted);font-size:13px;">Last updated 12:34:05</span>
    </div>
    <div class="sg-type-row">
      <span class="sg-type-label">dim / text-dim</span>
      <span style="color:var(--text-dim);font-size:13px;">48.0 kHz · 6 RX · 4 TX</span>
    </div>
    <div class="sg-type-row">
      <span class="sg-type-label">accent / text-accent</span>
      <span style="color:var(--text-accent);font-size:13px;">58.6 Hz offset</span>
    </div>
  </div>

  <!-- ── 3. DSP Chip Buttons ──────────────────────────────────────────── -->
  <h2 class="sg-section-title">3 · DSP Chip Buttons</h2>

  <div class="sg-group-label">All 9 chip types — normal state</div>
  <div class="sg-row" style="margin-bottom:12px;">
    <button class="badge" data-dsp="aec">AEC</button>
    <button class="badge" data-dsp="afs">AFS</button>
    <button class="badge" data-dsp="am">AM</button>
    <button class="badge" data-dsp="axm">AXM</button>
    <button class="badge" data-dsp="cmp">CMP</button>
    <button class="badge" data-dsp="deq">DEQ</button>
    <button class="badge" data-dsp="flt">FLT</button>
    <button class="badge" data-dsp="gte">GTE</button>
    <button class="badge" data-dsp="peq">PEQ</button>
  </div>

  <div class="sg-chip-group">
    <div style="display:flex;align-items:center;gap:12px;">
      <span class="sg-chip-state-label">normal</span>
      <div class="sg-row">
        <button class="badge" data-dsp="aec">AEC</button>
        <button class="badge" data-dsp="cmp">CMP</button>
        <button class="badge" data-dsp="peq">PEQ</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span class="sg-chip-state-label">.byp (bypass)</span>
      <div class="sg-row">
        <button class="badge byp" data-dsp="aec">AEC</button>
        <button class="badge byp" data-dsp="cmp">CMP</button>
        <button class="badge byp" data-dsp="peq">PEQ</button>
      </div>
      <span style="font-size:10px;color:var(--text-dim);">opacity 0.22</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span class="sg-chip-state-label">.blk-open</span>
      <div class="sg-row">
        <button class="badge blk-open" data-dsp="aec">AEC</button>
        <button class="badge blk-open" data-dsp="cmp">CMP</button>
        <button class="badge blk-open" data-dsp="peq">PEQ</button>
      </div>
      <span style="font-size:10px;color:var(--text-dim);">brightness 1.5 + border</span>
    </div>
  </div>

  <!-- ── 4. Status Indicators ─────────────────────────────────────────── -->
  <h2 class="sg-section-title">4 · Status Indicators</h2>

  <div class="sg-group-label">.status-dot variants</div>
  <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;">
    <div class="sg-indicator-row">
      <span class="status-dot status-dot-ok"></span>
      <span>Dante Connected</span>
      <span style="font-size:10px;color:var(--text-dim);">.status-dot-ok</span>
    </div>
    <div class="sg-indicator-row">
      <span class="status-dot status-dot-warn"></span>
      <span>Awaiting Sync</span>
      <span style="font-size:10px;color:var(--text-dim);">.status-dot-warn</span>
    </div>
    <div class="sg-indicator-row">
      <span class="status-dot status-dot-err"></span>
      <span>Disconnected</span>
      <span style="font-size:10px;color:var(--text-dim);">.status-dot-err</span>
    </div>
  </div>

  <div class="sg-group-label">.dot variants</div>
  <div style="display:flex;flex-direction:column;gap:4px;">
    <div class="sg-indicator-row">
      <span class="dot dot-live"></span>
      <span>Live</span>
      <span style="font-size:10px;color:var(--text-dim);">.dot-live — var(--dot-live) #3fb950</span>
    </div>
    <div class="sg-indicator-row">
      <span class="dot dot-offline"></span>
      <span>Offline</span>
      <span style="font-size:10px;color:var(--text-dim);">.dot-offline — var(--dot-offline) #484f58</span>
    </div>
    <div class="sg-indicator-row">
      <span class="dot dot-error"></span>
      <span>Error</span>
      <span style="font-size:10px;color:var(--text-dim);">.dot-error — var(--dot-error) #f85149</span>
    </div>
    <div class="sg-indicator-row">
      <span class="dot dot-warn"></span>
      <span>Warning</span>
      <span style="font-size:10px;color:var(--text-dim);">.dot-warn — var(--color-warn) #d29922</span>
    </div>
  </div>

  <!-- ── 5. Buttons ──────────────────────────────────────────────────── -->
  <h2 class="sg-section-title">5 · Buttons</h2>

  <div class="sg-row" style="align-items:center;">
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <button class="btn-accent">Apply</button>
      <span style="font-size:10px;color:var(--text-dim);">.btn-accent</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <button class="btn-secondary">Cancel</button>
      <span style="font-size:10px;color:var(--text-dim);">.btn-secondary</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <button class="btn-danger">Delete</button>
      <span style="font-size:10px;color:var(--text-dim);">.btn-danger</span>
    </div>
  </div>

  <!-- ── 6. Zone Color Palette ────────────────────────────────────────── -->
  <h2 class="sg-section-title">6 · Zone Color Palette</h2>

  <div class="sg-row">
    <div class="sg-zone-bar" style="border-left-color:#58a6ff;color:#58a6ff;">Zone 0</div>
    <div class="sg-zone-bar" style="border-left-color:#3fb950;color:#3fb950;">Zone 1</div>
    <div class="sg-zone-bar" style="border-left-color:#d29922;color:#d29922;">Zone 2</div>
    <div class="sg-zone-bar" style="border-left-color:#c678dd;color:#c678dd;">Zone 3</div>
    <div class="sg-zone-bar" style="border-left-color:#f0883e;color:#f0883e;">Zone 4</div>
    <div class="sg-zone-bar" style="border-left-color:#85c46a;color:#85c46a;">Zone 5</div>
    <div class="sg-zone-bar" style="border-left-color:#ff7b72;color:#ff7b72;">Zone 6</div>
    <div class="sg-zone-bar" style="border-left-color:#79c0ff;color:#79c0ff;">Zone 7</div>
    <div class="sg-zone-bar" style="border-left-color:#56d364;color:#56d364;">Zone 8</div>
    <div class="sg-zone-bar" style="border-left-color:#e3b341;color:#e3b341;">Zone 9</div>
  </div>

  <!-- ── 7. Crosspoints (Matrix) ─────────────────────────────────────── -->
  <h2 class="sg-section-title">7 · Crosspoints (Matrix)</h2>

  <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">
    <div>
      <div class="sg-group-label" style="margin-top:0;">3×3 demo</div>
      <div class="sg-xp-grid">
        <!-- row 1 -->
        <div class="sg-xp-cell"><div class="sg-xp-dot"></div></div>
        <div class="sg-xp-cell"><div class="sg-xp-dot local"></div></div>
        <div class="sg-xp-cell"><div class="sg-xp-dot"></div></div>
        <!-- row 2 -->
        <div class="sg-xp-cell"><div class="sg-xp-dot dante"></div></div>
        <div class="sg-xp-cell"><div class="sg-xp-dot"></div></div>
        <div class="sg-xp-cell"><div class="sg-xp-dot local"></div></div>
        <!-- row 3 -->
        <div class="sg-xp-cell"><div class="sg-xp-dot"></div></div>
        <div class="sg-xp-cell"><div class="sg-xp-dot dante"></div></div>
        <div class="sg-xp-cell"><div class="sg-xp-dot"></div></div>
      </div>
    </div>
    <div style="font-size:11px;display:flex;flex-direction:column;gap:8px;">
      <div class="sg-indicator-row" style="gap:10px;">
        <div class="sg-xp-dot" style="width:24px;height:24px;border-radius:4px;background:transparent;border:1px solid var(--border-primary);flex-shrink:0;"></div>
        <span>empty — .xp-cell</span>
      </div>
      <div class="sg-indicator-row" style="gap:10px;">
        <div class="sg-xp-dot local" style="width:24px;height:24px;border-radius:4px;background:var(--xp-local);border-color:var(--xp-local);box-shadow:0 0 10px 2px var(--xp-local);flex-shrink:0;"></div>
        <span style="color:var(--xp-local);">local — .xp-active.xp-local</span>
      </div>
      <div class="sg-indicator-row" style="gap:10px;">
        <div class="sg-xp-dot dante" style="width:24px;height:24px;border-radius:4px;background:var(--xp-dante);border-color:var(--xp-dante);box-shadow:0 0 10px 2px var(--xp-dante);flex-shrink:0;"></div>
        <span style="color:var(--xp-dante);">dante — .xp-active.xp-dante</span>
      </div>
    </div>
  </div>

  <!-- ── 8. Section Accents ───────────────────────────────────────────── -->
  <h2 class="sg-section-title">8 · Section Accents</h2>

  <div class="sg-row">
    <div>
      <div class="sg-section-bar" style="border-left-color:var(--color-accent);color:var(--color-accent);">─ INPUT</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">--color-accent</div>
    </div>
    <div>
      <div class="sg-section-bar" style="border-left-color:var(--color-bus);color:var(--color-bus);">─ BUS</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">--color-bus</div>
    </div>
    <div>
      <div class="sg-section-bar" style="border-left-color:var(--vca-color);color:var(--vca-color);">─ VCA</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">--vca-color</div>
    </div>
    <div>
      <div class="sg-section-bar" style="border-left-color:var(--gen-sine);color:var(--gen-sine);">─ GENERATOR</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">--gen-sine</div>
    </div>
  </div>

  <!-- ── 9. Generator Badges ──────────────────────────────────────────── -->
  <h2 class="sg-section-title">9 · Generator Badges</h2>

  <div class="sg-row" style="align-items:center;">
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <span class="sg-gen-badge" style="color:var(--gen-sine);border-color:var(--gen-sine);background:rgba(8,145,178,0.12);">SINE</span>
      <span style="font-size:10px;color:var(--text-dim);">--gen-sine</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <span class="sg-gen-badge" style="color:var(--gen-white);border-color:var(--gen-white);background:rgba(148,163,184,0.12);">WHITE</span>
      <span style="font-size:10px;color:var(--text-dim);">--gen-white</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <span class="sg-gen-badge" style="color:var(--gen-pink);border-color:var(--gen-pink);background:rgba(244,114,182,0.12);">PINK</span>
      <span style="font-size:10px;color:var(--text-dim);">--gen-pink</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <span class="sg-gen-badge" style="color:var(--gen-sweep);border-color:var(--gen-sweep);background:rgba(245,158,11,0.12);">SWEEP</span>
      <span style="font-size:10px;color:var(--text-dim);">--gen-sweep</span>
    </div>
  </div>

  <!-- ── 10. Toast Examples ───────────────────────────────────────────── -->
  <h2 class="sg-section-title">10 · Toast Examples</h2>

  <div class="sg-row" style="align-items:flex-start;">
    <div style="display:flex;flex-direction:column;gap:4px;">
      <div class="sg-toast" style="border-left-color:var(--color-accent);color:var(--text-primary);">
        <div class="sg-toast-title" style="color:var(--color-accent);">Info</div>
        Scene "Main PA" applied successfully.
      </div>
      <span style="font-size:10px;color:var(--text-dim);">.toast-item--info</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <div class="sg-toast" style="border-left-color:var(--color-ok);color:var(--color-ok);">
        <div class="sg-toast-title">OK</div>
        Dante subscription confirmed.
      </div>
      <span style="font-size:10px;color:var(--text-dim);">.toast-item--success</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <div class="sg-toast" style="border-left-color:var(--color-danger);color:var(--color-danger);">
        <div class="sg-toast-title">Error</div>
        Failed to apply crosspoint: timeout.
      </div>
      <span style="font-size:10px;color:var(--text-dim);">.toast-item--error</span>
    </div>
  </div>

  <div style="margin-top:32px;padding-top:12px;border-top:1px solid var(--border-subtle);font-size:10px;color:var(--text-dim);">
    Minos Design System · IBM Plex Mono 13px · Industrial DSP Console aesthetic
  </div>

</div>
`;

  return () => {};
}
