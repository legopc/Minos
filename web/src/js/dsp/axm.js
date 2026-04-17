// dsp/axm.js — Automixer (Dugan gain-sharing) channel panel
import { selectRow, sliderRow, toggleRow, fmtPlain } from './common.js';

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

export function buildContent(channelId, params, accentColor, { onChange, onBypass }) {
  const p = Object.assign({ group_id: null, weight: 1.0, enabled: false }, params);
  const el = document.createElement('div');
  el.className = 'dsp-content axm';

  function emit() { onChange(BK, { group_id: p.group_id ?? '', weight: p.weight, enabled: p.enabled }); }

  el.appendChild(toggleRow('Enable', p.enabled, v => {
    p.enabled = v;
    onBypass(BK, !v);
  }));

  const { el: groupRow, sel: groupSel } = selectRow('Group', [{ value: '', label: '— no group —' }], p.group_id ?? '', v => {
    p.group_id = v === '' ? null : v;
    emit();
  });
  el.appendChild(groupRow);

  _fetchGroups().then(groups => {
    while (groupSel.options.length > 1) groupSel.remove(1);
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      if (p.group_id === g.id) opt.selected = true;
      groupSel.appendChild(opt);
    });
    if (!p.group_id) groupSel.options[0].selected = true;
  });

  el.appendChild(sliderRow('Weight', 0.1, 4.0, 0.01, p.weight, fmtPlain, v => {
    p.weight = v;
    emit();
  }));

  return el;
}
