// dsp/axm.js — Automixer (Dugan gain-sharing) channel panel
const BK = 'axm';

let _groupCache = null;

async function _fetchGroups() {
  if (_groupCache) return _groupCache;
  try {
    const r = await fetch('/api/v1/automixer-groups');
    if (r.ok) { _groupCache = (await r.json()).automixer_groups ?? []; }
    else _groupCache = [];
  } catch { _groupCache = []; }
  return _groupCache;
}

export function invalidateGroupCache() { _groupCache = null; }

export function buildContent(channelId, params, accentColor, { onChange }) {
  const p = Object.assign({ group_id: null, weight: 1.0 }, params);
  const el = document.createElement('div');
  el.className = 'dsp-content axm';

  function emit() { onChange(BK, { group_id: p.group_id ?? '', weight: p.weight }); }

  // Group selector (populated async)
  const sel = document.createElement('select');
  sel.className = 'dsp-select';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '— no group —';
  sel.appendChild(noneOpt);
  if (!p.group_id) noneOpt.selected = true;
  sel.onchange = () => {
    p.group_id = sel.value === '' ? null : sel.value;
    emit();
  };

  _fetchGroups().then(groups => {
    // Rebuild options preserving none
    while (sel.options.length > 1) sel.remove(1);
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      if (p.group_id === g.id) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!p.group_id) noneOpt.selected = true;
  });

  el.appendChild(_row('Group', sel));

  // Weight slider (0.1 – 4.0)
  const wtVal = document.createElement('span');
  wtVal.className = 'dsp-value';
  wtVal.textContent = p.weight.toFixed(2);
  const wt = document.createElement('input');
  wt.type = 'range';
  wt.className = 'dsp-slider';
  wt.min = '0.1'; wt.max = '4.0'; wt.step = '0.01';
  wt.value = String(p.weight);
  wt.oninput = () => {
    p.weight = parseFloat(wt.value);
    wtVal.textContent = p.weight.toFixed(2);
    emit();
  };
  el.appendChild(_row('Weight', wt, wtVal));

  return el;
}

function _row(label, ctrl, val) {
  const d = document.createElement('div'); d.className = 'dsp-row';
  const l = document.createElement('span'); l.className = 'dsp-label'; l.textContent = label;
  d.appendChild(l); d.appendChild(ctrl); if (val) d.appendChild(val); return d;
}
