import { state } from './state.js';
import { DSP_COLOURS } from './dsp/colours.js';
import * as api from './api.js';
import { toast } from './toast.js';

let zTop = 200;
let paramChangeDebounce = new Map();

function injectStyles() {
  if (document.getElementById('dsp-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'dsp-panel-styles';
  style.textContent = `
.dsp-panel {
  position: absolute;
  min-width: 240px;
  max-width: 360px;
  background: var(--bg-surface);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  user-select: none;
}
.dsp-panel-header {
  display: flex;
  align-items: center;
  height: var(--row-h);
  padding: 0 8px;
  border-bottom: 1px solid var(--border-primary);
  border-left: 3px solid;
  cursor: move;
  gap: 8px;
}
.dsp-panel-title {
  flex: 1;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}
.dsp-panel-close {
  font-size: 14px;
  color: var(--text-dim);
  cursor: pointer;
  line-height: 1;
  border: none;
  background: none;
  padding: 0;
}
.dsp-panel-close:hover {
  color: var(--text-primary);
}
.dsp-panel-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
.dsp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--row-h);
}
.dsp-label {
  width: 72px;
  font-size: 9px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.dsp-value {
  width: 52px;
  font-size: 9px;
  color: var(--text-accent);
  text-align: right;
  flex-shrink: 0;
}
.dsp-slider {
  flex: 1;
  min-width: 80px;
}
.dsp-byp-btn {
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 9px;
  border: 1px solid var(--border-primary);
  background: var(--bg-dark);
  color: var(--text-muted);
  cursor: pointer;
}
.dsp-byp-btn.active {
  background: var(--text-accent);
  color: var(--bg-dark);
  border-color: var(--text-accent);
}
  `;
  document.head.appendChild(style);
}

injectStyles();

export function openPanel(blockKey, channelId, triggerEl) {
  const pid = `panel_${blockKey}_${channelId}`;
  if (state.openPanels.has(pid)) {
    closePanel(pid);
    return;
  }

  const app = document.getElementById('app');
  const ar = app.getBoundingClientRect();
  const br = (triggerEl && typeof triggerEl.getBoundingClientRect === 'function')
    ? triggerEl.getBoundingClientRect()
    : triggerEl;  // accept pre-captured DOMRect
  
  const panelWidth  = 360;
  const panelHeight = 420;
  
  let x = br.left - ar.left + 8;
  let y = br.bottom - ar.top + 4;
  
  // Clamp right edge
  if (x + panelWidth > ar.width)  x = Math.max(0, br.left - ar.left - panelWidth - 4);
  x = Math.max(4, Math.min(x, ar.width - panelWidth - 4));
  
  // Clamp bottom edge — flip above trigger
  if (y + panelHeight > ar.height) y = Math.max(4, br.top - ar.top - panelHeight - 4);
  y = Math.max(4, y);

  const el = buildPanelEl(blockKey, channelId, pid);
  el.style.cssText = `position:absolute;left:${x}px;top:${y}px;z-index:${++zTop}`;
  app.appendChild(el);
  makeDraggable(el, app);
  el.addEventListener('pointerdown', () => {
    el.style.zIndex = ++zTop;
  });

  if (triggerEl && triggerEl.classList) triggerEl.classList.add('blk-open');
  state.openPanels.set(pid, { blockKey, channelId, el, triggerEl });
}

export function closePanel(pid) {
  const p = state.openPanels.get(pid);
  if (!p) return;
  p.el.remove();
  if (p.triggerEl && p.triggerEl.classList) p.triggerEl.classList.remove('blk-open');
  state.openPanels.delete(pid);
}

export function closeAllPanels() {
  for (const pid of state.openPanels.keys()) {
    closePanel(pid);
  }
}

function buildPanelEl(blockKey, channelId, pid) {
  const panel = document.createElement('div');
  panel.className = 'dsp-panel';
  panel.id = pid;

  const color = DSP_COLOURS[blockKey]?.fg ?? '#888';

  const header = document.createElement('div');
  header.className = 'dsp-panel-header';
  header.style.borderLeftColor = color;

  const title = document.createElement('div');
  title.className = 'dsp-panel-title';
  title.textContent = `${blockKey} · ${channelId}`;
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'dsp-panel-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => closePanel(pid));
  header.appendChild(closeBtn);

  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'dsp-panel-body';
  panel.appendChild(body);

  _loadContent(blockKey, channelId, body);

  return panel;
}

async function _loadContent(blockKey, channelId, contentEl) {
  try {
    const mod = await import(`./dsp/${blockKey}.js`);
    const isBus = channelId.startsWith('bus_');
    const ch = isBus
      ? state.buses.get(channelId)
      : state.channels.get(channelId) ?? state.outputs.get(channelId);
    const blockData = ch?.dsp?.[blockKey] ?? {};
    const params = { ...(blockData.params ?? {}), bypassed: blockData.bypassed ?? false, enabled: blockData.enabled ?? true };
    const accent = DSP_COLOURS[blockKey]?.fg ?? '#888';

    contentEl.appendChild(
      mod.buildContent(channelId, params, accent, {
        onChange: (block, newParams) =>
          _onParamChange(channelId, block, newParams),
        onBypass: (block, bypassed) => _onBypass(channelId, block, bypassed),
      })
    );
  } catch (err) {
    console.error(`Failed to load DSP module ${blockKey}:`, err);
    contentEl.innerHTML =
      '<span style="color: var(--text-error);">Failed to load</span>';
  }
}

function _onParamChange(channelId, block, newParams) {
  const key = `${channelId}_${block}`;
  if (paramChangeDebounce.has(key)) {
    clearTimeout(paramChangeDebounce.get(key));
  }

  const timeoutId = setTimeout(async () => {
    try {
      const isBus = channelId.startsWith('bus_');
      const isRx = channelId.startsWith('rx_');
      const idx = parseInt(channelId.split('_')[1], 10);
      let base;
      if (isBus) {
        base = `/buses/${channelId}`;
      } else {
        base = isRx ? `/inputs/${idx}` : `/outputs/${idx}`;
      }

      if (block === 'flt') {
        const promises = [];
        if (newParams.hpf) promises.push(api.put(`${base}/hpf`, newParams.hpf));
        if (newParams.lpf) promises.push(api.put(`${base}/lpf`, newParams.lpf));
        await Promise.all(promises);
        let ch;
        if (isBus) {
          ch = state.buses.get(channelId);
        } else {
          ch = isRx ? state.channels.get(channelId) : state.outputs.get(channelId);
        }
        if (ch?.dsp?.flt?.params) {
          if (newParams.hpf) Object.assign(ch.dsp.flt.params.hpf, newParams.hpf);
          if (newParams.lpf) Object.assign(ch.dsp.flt.params.lpf, newParams.lpf);
        }
        paramChangeDebounce.delete(key);
        return;
      }

      const blockMap = {
        peq: 'eq',
        cmp: 'compressor',
        gte: 'gate',
        lim: 'limiter',
        dly: 'delay',
        aec: 'aec',
        axm: 'automixer',
        afs: 'feedback',
        deq: 'deq',
      };
      const mappedBlock = blockMap[block] || block;
      const endpoint = `${base}/${mappedBlock}`;

      await api.put(endpoint, newParams);

      const ch = isBus
        ? state.buses.get(channelId)
        : isRx
          ? state.channels.get(channelId)
          : state.outputs.get(channelId);
      if (ch && ch.dsp && ch.dsp[block]) {
        ch.dsp[block] = { ...ch.dsp[block], params: { ...(ch.dsp[block].params ?? {}), ...newParams } };
      }
    } catch (err) {
      console.error('Parameter change failed:', err);
      toast('Error updating DSP parameters', 'error');
    }
    paramChangeDebounce.delete(key);
  }, 100);

  paramChangeDebounce.set(key, timeoutId);
}

async function _onBypass(channelId, block, bypassed) {
  try {
    const isBus = channelId.startsWith('bus_');
    const isRx = channelId.startsWith('rx_');
    const idx = parseInt(channelId.split('_')[1], 10);
    let base;
    if (isBus) {
      base = `/buses/${channelId}`;
    } else {
      base = isRx ? `/inputs/${idx}` : `/outputs/${idx}`;
    }
    let ch;
    if (isBus) {
      ch = state.buses.get(channelId);
    } else {
      ch = isRx ? state.channels.get(channelId) : state.outputs.get(channelId);
    }

    if (block === 'flt') {
      const fltParams = ch?.dsp?.flt?.params ?? {};
      await Promise.all([
        api.put(`${base}/hpf`, { enabled: !bypassed, freq_hz: fltParams.hpf?.freq_hz ?? 80 }),
        api.put(`${base}/lpf`, { enabled: !bypassed, freq_hz: fltParams.lpf?.freq_hz ?? 18000 }),
      ]);
      if (ch?.dsp?.flt) ch.dsp.flt.bypassed = bypassed;
      // Sync badge DOM for flt block
      const shouldByp = bypassed || !ch.dsp.flt.enabled;
      document.querySelectorAll(
        '[data-block="' + block + '"][data-ch="' + channelId + '"]'
      ).forEach(function(el) {
        el.classList.toggle('byp', shouldByp);
      });
      return;
    }

    const blockMap = { peq: 'eq', cmp: 'compressor', gte: 'gate', lim: 'limiter', dly: 'delay' };
    const mappedBlock = blockMap[block] || block;
    const blockData = ch?.dsp?.[block] ?? {};
    const fullParams = { ...(blockData.params ?? {}), enabled: !bypassed };

    await api.put(`${base}/${mappedBlock}`, fullParams);

    if (ch?.dsp?.[block]) ch.dsp[block].bypassed = bypassed;
    // Sync badge DOM for other blocks
    const shouldByp = bypassed || !ch.dsp[block].enabled;
    document.querySelectorAll(
      '[data-block="' + block + '"][data-ch="' + channelId + '"]'
    ).forEach(function(el) {
      el.classList.toggle('byp', shouldByp);
    });
  } catch (err) {
    console.error('Bypass change failed:', err);
    toast('Error updating DSP bypass state', 'error');
  }
}

function makeDraggable(el, container) {
  const header = el.querySelector('.dsp-panel-header');
  let isDragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;

  function handleStart(e) {
    isDragging = true;
    startLeft = el.offsetLeft;
    startTop = el.offsetTop;
    startX = e.clientX;
    startY = e.clientY;
    el.style.userSelect = 'none';
    header.setPointerCapture(e.pointerId);
  }

  function handleMove(e) {
    if (!isDragging) return;
    e.preventDefault?.();
    let x = startLeft + (e.clientX - startX);
    let y = startTop + (e.clientY - startY);
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    x = Math.max(0, Math.min(x, containerRect.width - elRect.width));
    y = Math.max(0, Math.min(y, containerRect.height - elRect.height));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function handleEnd() {
    isDragging = false;
    el.style.userSelect = '';
  }

  header.addEventListener('pointerdown', handleStart);
  header.addEventListener('pointermove', handleMove);
  header.addEventListener('pointerup', handleEnd);
  header.addEventListener('pointercancel', handleEnd);
}
