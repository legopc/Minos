import { state } from './state.js';
import { DSP_COLOURS } from './dsp/colours.js';
import { blockMap as dspBlockMap } from './dsp/registry.js';
import * as api from './api.js';
import { toast } from './toast.js';
import { undo } from './undo.js';

const DSP_HELP = {
  peq: 'Parametric EQ — 4 bands with Bell, Low-shelf, and High-shelf filters. Drag the frequency response curve to tune.',
  cmp: 'Compressor — reduces dynamic range above the threshold. Shows gain reduction in the GR meter.',
  gte: 'Gate/Expander — silences signals below the threshold, eliminating background noise.',
  lim: 'Limiter — hard ceiling that prevents clipping. Shows gain reduction in the GR meter.',
  dly: 'Delay — adds latency (0–1000 ms). TX channels also offer TPDF dither control.',
  aec: 'Acoustic Echo Canceller — uses an output reference to remove echo and feedback.',
  axm: 'Automixer — Dugan gain-sharing across a mic group. Higher weight = higher priority.',
  afs: 'Feedback Suppressor — dynamic notch filters that automatically detect and kill feedback.',
  deq: 'Dynamic EQ — parametric EQ bands with dynamic compression per band.',
  flt: 'Filter — high-pass and low-pass frequency filters to shape the signal.',
};

let zTop = 200;
let paramChangeDebounce = new Map();

function _clone(v) {
  try { return structuredClone(v); } catch (_) {}
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function _getCh(channelId) {
  if (channelId.startsWith('bus_')) return state.buses.get(channelId);
  if (channelId.startsWith('rx_'))  return state.channels.get(channelId);
  return state.outputs.get(channelId);
}

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

  const isWide = (blockKey === 'peq' || blockKey === 'deq');
  const panelWidth  = isWide ? 420 : 320;
  const panelHeight = 480;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const br = (triggerEl && typeof triggerEl.getBoundingClientRect === 'function')
    ? triggerEl.getBoundingClientRect()
    : triggerEl;

  let x = (br?.left ?? 100) + 8;
  let y = (br?.bottom ?? 100) + 4;

  if (x + panelWidth > vw)  x = Math.max(4, (br?.left ?? 100) - panelWidth - 4);
  x = Math.max(4, Math.min(x, vw - panelWidth - 4));
  if (y + panelHeight > vh) y = Math.max(4, (br?.top ?? 100) - panelHeight - 4);
  y = Math.max(4, y);

  const el = buildPanelEl(blockKey, channelId, pid, isWide);
  el.style.cssText = `left:${x}px;top:${y}px;z-index:${++zTop}`;
  document.body.appendChild(el);
  makeDraggable(el);
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

function _showHelp(blockKey, desc) {
  document.getElementById('dsp-help-overlay')?.remove();
  const label = (DSP_COLOURS[blockKey]?.label ?? blockKey).toUpperCase();
  const overlay = document.createElement('div');
  overlay.id = 'dsp-help-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="modal-title">${label}</h2>
      <p class="modal-body" style="font-size:12px;line-height:1.6">${desc}</p>
      <div class="modal-actions"><button class="modal-confirm">OK</button></div>
    </div>
  `;
  overlay.querySelector('.modal-confirm').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function buildPanelEl(blockKey, channelId, pid, isWide) {
  const panel = document.createElement('div');
  panel.className = 'dsp-panel' + (isWide ? ' dsp-panel--wide' : '');
  panel.id = pid;

  const color = DSP_COLOURS[blockKey]?.fg ?? '#888';

  const header = document.createElement('div');
  header.className = 'dsp-panel-header';
  header.style.borderLeftColor = color;

  const title = document.createElement('div');
  title.className = 'dsp-panel-title';
  title.style.color = color;
  const chObj = _getCh(channelId);
  const chName = chObj?.name ?? channelId;
  const blockLabel = (DSP_COLOURS[blockKey]?.label ?? blockKey).toUpperCase();
  title.textContent = `${blockLabel} · ${chName}`;
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'dsp-panel-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('pointerdown', e => e.stopPropagation());
  closeBtn.addEventListener('click', () => closePanel(pid));

  const helpDesc = DSP_HELP[blockKey];
  if (helpDesc) {
    const helpBtn = document.createElement('button');
    helpBtn.className = 'dsp-panel-help';
    helpBtn.textContent = 'ⓘ';
    helpBtn.title = helpDesc;
    helpBtn.addEventListener('pointerdown', e => e.stopPropagation());
    helpBtn.addEventListener('click', () => _showHelp(blockKey, helpDesc));
    header.appendChild(helpBtn);
  }

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
    const ch = _getCh(channelId);
    const blockData = ch?.dsp?.[blockKey] ?? {};
    const params = { ...(blockData.params ?? {}), bypassed: blockData.bypassed ?? false, enabled: blockData.enabled ?? false };
    const accent = DSP_COLOURS[blockKey]?.fg ?? '#888';

    contentEl.appendChild(
      mod.buildContent(channelId, params, accent, {
        onChange: (block, newParams) =>
          _onParamChange(channelId, block, newParams),
        onBypass: (block, bypassed) => _onBypass(channelId, block, bypassed),
      })
    );

    syncBadges(channelId, blockKey);
  } catch (err) {
    console.error(`Failed to load DSP module ${blockKey}:`, err);
    contentEl.innerHTML =
      '<span style="color: var(--text-error);">Failed to load</span>';
  }
}

/**
 * Sync badge visual state (byp / dsp-active) for all matching badge elements.
 */
export function syncBadges(channelId, block) {
  const ch = _getCh(channelId);
  if (!ch?.dsp?.[block]) return;
  const bd = ch.dsp[block];
  const isByp    = !!bd.bypassed || !bd.enabled;
  const isActive = !!bd.enabled && !bd.bypassed;
  document.querySelectorAll(
    `[data-block="${block}"][data-ch="${channelId}"]`
  ).forEach(el => {
    el.classList.toggle('byp',        isByp);
    el.classList.toggle('dsp-active', isActive);
  });
}

function _onParamChange(channelId, block, newParams) {
  const key = `${channelId}_${block}`;
  const existing = paramChangeDebounce.get(key);
  if (existing?.timeoutId) clearTimeout(existing.timeoutId);

  const isBus = channelId.startsWith('bus_');
  const isRx = channelId.startsWith('rx_');
  const idx = parseInt(channelId.split('_')[1], 10);
  const base = isBus ? `/buses/${channelId}` : (isRx ? `/inputs/${idx}` : `/outputs/${idx}`);

  const getCh = () => _getCh(channelId);

  const before = existing?.before ?? (() => {
    const ch = getCh();
    const bd = ch?.dsp?.[block] ?? {};
    return {
      enabled: bd.enabled ?? false,
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
        const afterEnabled = after?.enabled ?? false;

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
        syncBadges(channelId, block);

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

    const getCh = () => _getCh(channelId);

    const ch0 = getCh();
    const beforeByp = !!(ch0?.dsp?.[block]?.bypassed);

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
        syncBadges(channelId, block);
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
      syncBadges(channelId, block);
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

function makeDraggable(el) {
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
    const x = Math.max(0, Math.min(startLeft + (e.clientX - startX), window.innerWidth  - el.offsetWidth));
    const y = Math.max(0, Math.min(startTop  + (e.clientY - startY), window.innerHeight - el.offsetHeight));
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
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
