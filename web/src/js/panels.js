import { state } from './state.js';
import { DSP_COLOURS } from './dsp/colours.js';
import { blockMap as dspBlockMap } from './dsp/registry.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { undo } from './undo.js';

let zTop = 200;
let paramChangeDebounce = new Map();

function _clone(v) {
  try { return structuredClone(v); } catch (_) {}
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

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

/**
 * Open a DSP processor panel for an audio channel.
 * @param {DspKind} blockKey - DSP processor kind (peq, cmp, gte, etc.)
 * @param {string} channelId - Channel ID (e.g., "rx_0", "tx_1", "bus_0")
 * @param {Element|DOMRect} triggerEl - Trigger element or its bounding rect
 */
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

/**
 * Close a DSP processor panel.
 * @param {string} pid - Panel ID (e.g., "panel_peq_rx_0")
 */
export function closePanel(pid) {
  const p = state.openPanels.get(pid);
  if (!p) return;
  p.el.remove();
  if (p.triggerEl && p.triggerEl.classList) p.triggerEl.classList.remove('blk-open');
  state.openPanels.delete(pid);
}

/**
 * Close all open DSP processor panels.
 */
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
  const existing = paramChangeDebounce.get(key);
  if (existing?.timeoutId) clearTimeout(existing.timeoutId);

  const isBus = channelId.startsWith('bus_');
  const isRx = channelId.startsWith('rx_');
  const idx = parseInt(channelId.split('_')[1], 10);
  const base = isBus ? `/buses/${channelId}` : (isRx ? `/inputs/${idx}` : `/outputs/${idx}`);

  const getCh = () => isBus
    ? state.buses.get(channelId)
    : isRx
      ? state.channels.get(channelId)
      : state.outputs.get(channelId);

  const before = existing?.before ?? (() => {
    const ch = getCh();
    const bd = ch?.dsp?.[block] ?? {};
    return {
      enabled: bd.enabled ?? true,
      params: _clone(bd.params ?? {}),
      flt: block === 'flt'
        ? {
          hpf: _clone(ch?.dsp?.flt?.params?.hpf ?? null),
          lpf: _clone(ch?.dsp?.flt?.params?.lpf ?? null),
        }
        : null,
    };
  })();

  const entry = {
    before,
    after: _clone(newParams),
    timeoutId: setTimeout(async () => {
      try {
        const after = entry.after;

        if (block === 'flt') {
          const changed = { hpf: !!after?.hpf, lpf: !!after?.lpf };

          const applyFlt = async (params) => {
            const promises = [];
            if (changed.hpf && params.hpf) promises.push(api.put(`${base}/hpf`, { kind: 'flt', enabled: params.hpf?.enabled ?? true, version: 1, params: params.hpf }));
            if (changed.lpf && params.lpf) promises.push(api.put(`${base}/lpf`, { kind: 'flt', enabled: params.lpf?.enabled ?? true, version: 1, params: params.lpf }));
            await Promise.all(promises);

            const ch = getCh();
            if (ch?.dsp?.flt?.params) {
              if (changed.hpf && params.hpf) Object.assign(ch.dsp.flt.params.hpf, params.hpf);
              if (changed.lpf && params.lpf) Object.assign(ch.dsp.flt.params.lpf, params.lpf);
            }
          };

          await applyFlt(after);

          const label = `DSP flt: ${channelId}`;
          const beforeFlt = {
            hpf: changed.hpf ? before.flt?.hpf : null,
            lpf: changed.lpf ? before.flt?.lpf : null,
          };

          undo.push({
            label,
            apply: async () => applyFlt(after),
            revert: async () => applyFlt(beforeFlt),
          });

          paramChangeDebounce.delete(key);
          return;
        }

        const mappedBlock = dspBlockMap[block] || block;
        const endpoint = `${base}/${mappedBlock}`;
        const afterEnabled = after?.enabled ?? true;

        const applyBlock = async (params, enabled) => {
          await api.put(endpoint, { kind: block, enabled, version: 1, params });
          const ch = getCh();
          if (ch?.dsp?.[block]) {
            ch.dsp[block] = {
              ...ch.dsp[block],
              enabled,
              params: { ...(ch.dsp[block].params ?? {}), ...(params ?? {}) },
            };
          }
        };

        await applyBlock(after, afterEnabled);

        undo.push({
          label: `DSP ${block}: ${channelId}`,
          apply: async () => applyBlock(after, afterEnabled),
          revert: async () => applyBlock(before.params, before.enabled),
        });

      } catch (err) {
        console.error('Parameter change failed:', err);
        toast('Error updating DSP parameters', 'error');
      }
      paramChangeDebounce.delete(key);
    }, 160),
  };

  paramChangeDebounce.set(key, entry);
}

async function _onBypass(channelId, block, bypassed) {
  try {
    const isBus = channelId.startsWith('bus_');
    const isRx = channelId.startsWith('rx_');
    const idx = parseInt(channelId.split('_')[1], 10);
    const base = isBus ? `/buses/${channelId}` : (isRx ? `/inputs/${idx}` : `/outputs/${idx}`);

    const getCh = () => isBus
      ? state.buses.get(channelId)
      : isRx
        ? state.channels.get(channelId)
        : state.outputs.get(channelId);

    const ch0 = getCh();
    const beforeByp = !!(ch0?.dsp?.[block]?.bypassed);

    const syncBadges = () => {
      const ch = getCh();
      if (!ch?.dsp?.[block]) return;
      const shouldByp = !!(ch.dsp[block].bypassed) || !ch.dsp[block].enabled;
      document.querySelectorAll(
        '[data-block="' + block + '"][data-ch="' + channelId + '"]'
      ).forEach(function(el) {
        el.classList.toggle('byp', shouldByp);
      });
    };

    if (block === 'flt') {
      const applyFltByp = async (byp) => {
        const ch = getCh();
        const fltParams = ch?.dsp?.flt?.params ?? {};
        await Promise.all([
          api.put(`${base}/hpf`, { kind: 'flt', enabled: !byp, version: 1, params: { ...(fltParams.hpf ?? {}), enabled: !byp, freq_hz: fltParams.hpf?.freq_hz ?? 80 } }),
          api.put(`${base}/lpf`, { kind: 'flt', enabled: !byp, version: 1, params: { ...(fltParams.lpf ?? {}), enabled: !byp, freq_hz: fltParams.lpf?.freq_hz ?? 18000 } }),
        ]);
        if (ch?.dsp?.flt) {
          ch.dsp.flt.bypassed = byp;
          ch.dsp.flt.enabled = !byp;
        }
        syncBadges();
      };

      await applyFltByp(bypassed);

      undo.push({
        label: `${bypassed ? 'Bypass' : 'Enable'} DSP flt: ${channelId}`,
        apply: async () => applyFltByp(bypassed),
        revert: async () => applyFltByp(beforeByp),
      });
      return;
    }

    const mappedBlock = dspBlockMap[block] || block;
    const applyByp = async (byp) => {
      const ch = getCh();
      const blockData = ch?.dsp?.[block] ?? {};
      await api.put(`${base}/${mappedBlock}`, { kind: block, enabled: !byp, version: 1, params: blockData.params ?? {} });
      if (ch?.dsp?.[block]) {
        ch.dsp[block].bypassed = byp;
        ch.dsp[block].enabled = !byp;
      }
      syncBadges();
    };

    await applyByp(bypassed);

    undo.push({
      label: `${bypassed ? 'Bypass' : 'Enable'} DSP ${block}: ${channelId}`,
      apply: async () => applyByp(bypassed),
      revert: async () => applyByp(beforeByp),
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
