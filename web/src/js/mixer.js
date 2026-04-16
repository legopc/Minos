// mixer.js — Mixer tab
import * as st  from './state.js';
import * as api from './api.js';
import { openPanel } from './panels.js';
import { toast } from './toast.js';
import { DSP_COLOURS } from './dsp/colours.js';
import { buildBusRoutingContent } from './dsp/bus-routing.js';

let _animFrame = null;
let _soloSet = new Set();
let _pressTimer = null;
let _pressStartX = 0, _pressStartY = 0;

export function render(container) {
  container.innerHTML = '';
  container.id = 'tab-mixer';

  // Scene bar
  const sceneBar = document.createElement('div');
  sceneBar.className = 'mixer-scene-bar';
  sceneBar.id = 'mixer-scene-bar';
  container.appendChild(sceneBar);
  _renderSceneBar(sceneBar);

  // Solo indicator bar
  const soloInd = document.createElement('div');
  soloInd.className = 'mixer-solo-indicator';
  soloInd.id = 'mixer-solo-indicator';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'mixer-clear-solo-btn';
  clearBtn.textContent = '✕ CLEAR';
  clearBtn.setAttribute('aria-label', 'Clear all solos');
  clearBtn.onclick = async () => {
    try { await api.clearSolo(); } catch(e) { console.error(e); toast('Clear solo failed', true); }
  };
  soloInd.appendChild(clearBtn);
  container.appendChild(soloInd);

  // Row wrapper: input strips + zone masters side by side
  const body = document.createElement('div');
  body.className = 'mixer-body';
  container.appendChild(body);

  // Strip area (input channels)
  const strips = document.createElement('div');
  strips.className = 'mixer-strips';
  strips.id = 'mixer-strips';
  body.appendChild(strips);

  // Zone masters
  const masters = document.createElement('div');
  masters.className = 'mixer-zone-masters';
  masters.id = 'mixer-masters';
  body.appendChild(masters);

  _renderStrips(strips, masters);
}

function _renderSceneBar(bar) {
  const scenes = Array.isArray(st.state.scenes)
    ? st.state.scenes.filter(s => s.is_favourite)
    : [];
  bar.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'mixer-scene-label';
  label.textContent = 'Favourite Scenes:';
  bar.appendChild(label);

  // Left arrow button
  const leftArr = document.createElement('button');
  leftArr.className = 'mixer-scene-arrow hidden';
  leftArr.innerHTML = '◀';
  leftArr.setAttribute('touch-action', 'manipulation');
  bar.appendChild(leftArr);

  // Scroll container
  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'mixer-scene-scroll-container';
  
  if (!scenes.length) {
    const e = document.createElement('span');
    e.style.cssText = 'color:var(--text-muted);font-size:10px;';
    e.textContent = 'None starred';
    scrollContainer.appendChild(e);
  } else {
    scenes.slice(0, 8).forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'mixer-scene-btn' + (s.id === st.state.activeSceneId ? ' active' : '');
      btn.textContent = s.name ?? s.id;
      btn.onclick = async () => {
        try {
          await api.loadScene(s.id);
          st.setActiveScene(s.id);
          document.querySelectorAll('.mixer-scene-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          toast(`Loaded: ${s.name}`);
        } catch(e) { toast('Load failed', true); }
      };
      scrollContainer.appendChild(btn);
    });
  }
  bar.appendChild(scrollContainer);

  // Right arrow button
  const rightArr = document.createElement('button');
  rightArr.className = 'mixer-scene-arrow hidden';
  rightArr.innerHTML = '▶';
  rightArr.setAttribute('touch-action', 'manipulation');
  bar.appendChild(rightArr);

  // Scroll listener
  scrollContainer.addEventListener('scroll', () => {
    _updateSceneScrollArrows(scrollContainer, leftArr, rightArr);
  });

  // Arrow click handlers
  leftArr.onclick = () => {
    scrollContainer.scrollBy({ left: -120, behavior: 'smooth' });
  };
  rightArr.onclick = () => {
    scrollContainer.scrollBy({ left: 120, behavior: 'smooth' });
  };

  // Check initial state
  requestAnimationFrame(() => {
    _updateSceneScrollArrows(scrollContainer, leftArr, rightArr);
  });
}

function _updateSceneScrollArrows(container, leftArr, rightArr) {
  const canLeft  = container.scrollLeft > 0;
  const canRight = container.scrollLeft < container.scrollWidth - container.clientWidth - 5;
  leftArr.classList.toggle('hidden', !canLeft);
  rightArr.classList.toggle('hidden', !canRight);
}

function _renderStrips(strips, masters) {
  strips.innerHTML = '';
  masters.innerHTML = '';

  const channels = st.channelList();
  const outputs  = st.outputList();

  // Input strips — stereo link indicator lives inside even-indexed strips
  channels.forEach((ch, idx) => {
    const s = _buildInputStrip(ch, idx < channels.length - 1 ? channels[idx + 1] : null);
    strips.appendChild(s);
  });

  // Bus strips (in masters, before output strips — buses are outputs not inputs)
  const buses = st.busList();
  if (st.state.system?.show_buses_in_mixer !== false && buses.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'mixer-bus-separator';
    sep.textContent = 'BUSES';
    masters.appendChild(sep);
    buses.forEach(bus => masters.appendChild(_buildBusStrip(bus)));
  }

  // VCA Groups section
  const vcas = st.state.vcaGroups ?? [];
  if (vcas.length > 0 || true /* always show VCA section with add button */) {
    const vcaSep = document.createElement('div');
    vcaSep.className = 'mixer-vca-separator';
    vcaSep.textContent = 'VCA';
    masters.appendChild(vcaSep);
    vcas.forEach(vca => masters.appendChild(_buildVcaStrip(vca)));
    // Add VCA button
    const addBtn = document.createElement('button');
    addBtn.className = 'mixer-add-vca-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add VCA group';
    addBtn.onclick = () => _showAddVcaDialog();
    masters.appendChild(addBtn);
  }

  // Signal Generators section
  const gens = st.generatorList ? st.generatorList() : (st.state.generators ?? []);
  const genSep = document.createElement('div');
  genSep.className = 'mixer-gen-separator';
  genSep.textContent = 'GEN';
  masters.appendChild(genSep);
  gens.forEach(gen => masters.appendChild(_buildGenStrip(gen)));
  const addGenBtn = document.createElement('button');
  addGenBtn.className = 'mixer-add-gen-btn';
  addGenBtn.textContent = '+';
  addGenBtn.title = 'Add signal generator';
  addGenBtn.onclick = () => _showAddGenDialog();
  masters.appendChild(addGenBtn);

  // Output master strips (one per output, replaces zone-based iteration)
  const outSep = document.createElement('div');
  outSep.className = 'mixer-output-separator';
  outSep.textContent = 'OUTPUTS';
  masters.appendChild(outSep);
  outputs.forEach(out => {
    const m = _buildOutputMaster(out);
    masters.appendChild(m);
  });
}

function _buildStereoLinkBtn(leftCh, rightCh) {
  const leftIdx  = parseInt(leftCh.id.replace('rx_', ''), 10);
  const rightIdx = parseInt(rightCh.id.replace('rx_', ''), 10);
  const link     = st.getStereoLink(leftIdx);
  const linked   = !!(link?.linked);

  const wrap = document.createElement('div');
  wrap.className = 'stereo-link-connector' + (linked ? ' linked' : '');
  wrap.id = `stereo-link-${leftIdx}`;

  const btn = document.createElement('button');
  btn.className = 'stereo-link-btn';
  btn.textContent = linked ? '⛓ UNLINK' : '⛓ LINK';
  btn.title = linked
    ? `Unlink stereo pair ${leftIdx + 1}/${rightIdx + 1}`
    : `Link as stereo pair ${leftIdx + 1}/${rightIdx + 1}`;
  wrap.appendChild(btn);

  wrap.onclick = async (e) => {
    e.stopPropagation();
    try {
      if (linked) {
        await api.deleteStereoLink(leftIdx);
        st.setStereoLinks(st.state.stereoLinks.filter(sl => sl.left_channel !== leftIdx));
        wrap.classList.remove('linked');
        btn.textContent = '⛓ LINK';
      } else {
        await api.postStereoLink(leftIdx, rightIdx);
        const sl = { left_channel: leftIdx, right_channel: rightIdx, linked: true, pan: 0.0 };
        const existing = st.state.stereoLinks.filter(s => s.left_channel !== leftIdx);
        st.setStereoLinks([...existing, sl]);
        wrap.classList.add('linked');
        btn.textContent = '⛓ UNLINK';
      }
      // Trigger matrix re-render to update L/R badges
      const matCont = document.getElementById('tab-matrix');
      if (matCont) { const { render } = await import('./matrix.js'); render(matCont); }
    } catch(e) { toast(e.message, true); }
  };

  return wrap;
}

function _buildVcaStrip(vca) {
  const strip = document.createElement('div');
  strip.className = 'mixer-strip vca-strip';
  strip.id = `vca-strip-${vca.id}`;

  // Name + type badge
  const header = document.createElement('div');
  header.className = 'vca-strip-header';
  const nm = document.createElement('div');
  nm.className = 'strip-name';
  nm.textContent = vca.name ?? vca.id;
  nm.title = `${vca.group_type} VCA`;
  const badge = document.createElement('span');
  badge.className = 'vca-badge';
  badge.textContent = vca.group_type === 'input' ? 'IN' : 'OUT';
  header.appendChild(nm);
  header.appendChild(badge);
  strip.appendChild(header);

  // Members — dedicated edit button
  const memberIds = vca.members ?? vca.channel_ids ?? [];
  const members = document.createElement('div');
  members.className = 'vca-members';

  const membersLabel = document.createElement('span');
  membersLabel.className = 'vca-members-count';
  membersLabel.textContent = memberIds.length ? `${memberIds.length} member${memberIds.length !== 1 ? 's' : ''}` : 'no members';

  const editMembersBtn = document.createElement('button');
  editMembersBtn.className = 'vca-edit-members-btn';
  editMembersBtn.textContent = '✎';
  editMembersBtn.title = 'Edit members';
  editMembersBtn.onclick = (e) => { e.stopPropagation(); _openVcaMemberEditor(vca, membersLabel); };

  members.appendChild(membersLabel);
  members.appendChild(editMembersBtn);
  strip.appendChild(members);

  // Gain fader
  const gainDb = vca.gain_db ?? 0;
  const dbLabel = document.createElement('div');
  dbLabel.className = 'strip-fader-label';
  dbLabel.textContent = _db(gainDb);

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.min = 0; fader.max = 1000; fader.step = 1;
  fader.value = st.dbToSlider(gainDb);
  let fTimer;
  fader.oninput = () => {
    const db = st.sliderToDb(+fader.value);
    dbLabel.textContent = _db(db);
    clearTimeout(fTimer);
    fTimer = setTimeout(() => {
      api.putVcaGroup(vca.id, { gain_db: db }).catch(e => toast(e.message, true));
    }, 80);
  };
  strip.appendChild(dbLabel);
  strip.appendChild(fader);

  // Mute button
  const muteBtn = document.createElement('button');
  muteBtn.className = 'strip-mute-btn' + (vca.muted ? ' active' : '');
  muteBtn.textContent = 'MUTE';
  muteBtn.onclick = async () => {
    const nowMuted = muteBtn.classList.contains('active');
    try {
      await api.putVcaGroup(vca.id, { muted: !nowMuted });
      muteBtn.classList.toggle('active', !nowMuted);
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(muteBtn);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'vca-delete-btn';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete VCA group';
  delBtn.onclick = async () => {
    if (!confirm(`Delete VCA group "${vca.name}"?`)) return;
    try {
      await api.deleteVcaGroup(vca.id);
      st.removeVcaGroup(vca.id);
      strip.remove();
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(delBtn);

  return strip;
}

function _openVcaMemberEditor(vca, membersEl) {
  // Remove any existing popover
  document.querySelectorAll('.vca-member-popover').forEach(p => p.remove());

  const isInput = (vca.group_type ?? 'input') !== 'output';
  const candidates = isInput
    ? st.channelList().map(ch => ({ id: ch.id, label: ch.name || ch.id }))
    : st.outputList().map(out => ({ id: out.id, label: out.name || out.id }));

  const currentMembers = new Set(vca.members ?? vca.channel_ids ?? []);

  const pop = document.createElement('div');
  pop.className = 'vca-member-popover';

  const title = document.createElement('div');
  title.className = 'vca-member-popover-title';
  title.textContent = `Members — ${vca.name}`;
  pop.appendChild(title);

  const list = document.createElement('div');
  list.className = 'vca-member-list';

  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vca-member-empty';
    empty.textContent = isInput ? 'No input channels available' : 'No output channels available';
    list.appendChild(empty);
  } else {
    candidates.forEach(({ id, label }) => {
      const row = document.createElement('label');
      row.className = 'vca-member-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = currentMembers.has(id);
      cb.dataset.id = id;
      const span = document.createElement('span');
      span.textContent = label;
      row.appendChild(cb);
      row.appendChild(span);
      list.appendChild(row);
    });
  }
  pop.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'vca-member-popover-footer';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'vca-member-save-btn';
  saveBtn.onclick = async () => {
    const selected = [...list.querySelectorAll('input[type=checkbox]:checked')].map(c => c.dataset.id);
    try {
      await api.putVcaGroup(vca.id, { members: selected });
      vca.members = selected;
      membersEl.textContent = selected.length ? `${selected.length} member${selected.length !== 1 ? 's' : ''}` : 'no members';
      pop.remove();
    } catch(e) { toast(e.message, true); }
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'vca-member-cancel-btn';
  cancelBtn.onclick = () => pop.remove();

  footer.appendChild(saveBtn);
  footer.appendChild(cancelBtn);
  pop.appendChild(footer);

  // Position below the members label (body-level to escape overflow clipping)
  document.body.appendChild(pop);
  const rect = membersEl.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = rect.left + 'px';
  pop.style.top  = (rect.bottom + 4) + 'px';

  // Close on outside click
  const closeHandler = (e) => {
    if (!pop.contains(e.target) && e.target !== membersEl) {
      pop.remove();
      document.removeEventListener('click', closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
}

async function _showAddVcaDialog() {
  const name = prompt('VCA group name:');
  if (!name) return;
  const type = prompt('Type (input or output):', 'input');
  if (type !== 'input' && type !== 'output') { toast('Type must be "input" or "output"', true); return; }
  try {
    const result = await api.postVcaGroup({ name, group_type: type, members: [], gain_db: 0, muted: false });
    const vca = { id: result?.id ?? `vca_?`, name, group_type: type, members: [], gain_db: 0, muted: false };
    st.setVcaGroup(vca);
    const masters = document.getElementById('mixer-masters');
    const strips  = document.querySelector('.mixer-strips');
    if (strips && masters) _renderStrips(strips, masters);
  } catch(e) { toast(e.message, true); }
}

function _buildGenStrip(gen) {
  const strip = document.createElement('div');
  strip.className = 'mixer-strip gen-strip';
  strip.id = `gen-strip-${gen.id}`;

  const header = document.createElement('div');
  header.className = 'vca-strip-header';

  const nameEl = document.createElement('span');
  nameEl.className = 'strip-name gen-strip-name';
  nameEl.textContent = gen.name;

  const typeBadge = document.createElement('span');
  typeBadge.className = `gen-badge gen-type-${gen.gen_type}`;
  typeBadge.textContent = gen.gen_type === 'sine' ? 'SINE'
    : gen.gen_type === 'white_noise' ? 'WHT'
    : gen.gen_type === 'pink_noise' ? 'PNK'
    : 'SWP';

  header.appendChild(nameEl);
  header.appendChild(typeBadge);
  strip.appendChild(header);

  if (gen.gen_type === 'sine') {
    const freqWrap = document.createElement('div');
    freqWrap.className = 'gen-freq-wrap';
    const freqInput = document.createElement('input');
    freqInput.type = 'number';
    freqInput.className = 'gen-freq-input';
    freqInput.min = 20; freqInput.max = 20000; freqInput.step = 1;
    freqInput.value = gen.freq_hz ?? 1000;
    freqInput.title = 'Frequency (Hz)';
    freqInput.onchange = async () => {
      const f = parseFloat(freqInput.value);
      if (!isNaN(f)) {
        await api.putGenerator(gen.id, { freq_hz: f });
        gen.freq_hz = f;
      }
    };
    const freqLabel = document.createElement('span');
    freqLabel.className = 'gen-freq-label';
    freqLabel.textContent = 'Hz';
    freqWrap.appendChild(freqInput);
    freqWrap.appendChild(freqLabel);
    strip.appendChild(freqWrap);
  }

  if (gen.gen_type === 'freq_sweep') {
    const _makeFreqRow = (labelText, field, defaultVal) => {
      const wrap = document.createElement('div');
      wrap.className = 'gen-freq-wrap';
      const lbl = document.createElement('span');
      lbl.className = 'gen-freq-label';
      lbl.textContent = labelText;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'gen-freq-input';
      inp.min = 20; inp.max = 20000; inp.step = 1;
      inp.value = gen[field] ?? defaultVal;
      inp.title = labelText;
      inp.onchange = async () => {
        const f = parseFloat(inp.value);
        if (!isNaN(f)) {
          await api.putGenerator(gen.id, { [field]: f });
          gen[field] = f;
        }
      };
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      return wrap;
    };
    strip.appendChild(_makeFreqRow('Start Hz', 'sweep_start_hz', 20));
    strip.appendChild(_makeFreqRow('End Hz', 'sweep_end_hz', 20000));

    const durWrap = document.createElement('div');
    durWrap.className = 'gen-freq-wrap';
    const durLbl = document.createElement('span');
    durLbl.className = 'gen-freq-label';
    durLbl.textContent = 'Dur s';
    const durInp = document.createElement('input');
    durInp.type = 'number';
    durInp.className = 'gen-freq-input';
    durInp.min = 0.1; durInp.max = 300; durInp.step = 0.1;
    durInp.value = gen.sweep_duration_s ?? 10;
    durInp.title = 'Sweep duration (seconds)';
    durInp.onchange = async () => {
      const d = parseFloat(durInp.value);
      if (!isNaN(d)) {
        await api.putGenerator(gen.id, { sweep_duration_s: d });
        gen.sweep_duration_s = d;
      }
    };
    durWrap.appendChild(durLbl);
    durWrap.appendChild(durInp);
    strip.appendChild(durWrap);
  }

  const levelWrap = document.createElement('div');
  levelWrap.className = 'gen-level-wrap';
  const levelLabel = document.createElement('span');
  levelLabel.className = 'gen-level-label';
  levelLabel.textContent = isFinite(gen.level_db) ? gen.level_db.toFixed(1) + ' dB' : '−∞';
  const levelSlider = document.createElement('input');
  levelSlider.type = 'range';
  levelSlider.className = 'gen-level-slider';
  levelSlider.min = -96; levelSlider.max = 0; levelSlider.step = 0.5;
  levelSlider.value = isFinite(gen.level_db) ? gen.level_db : -96;
  levelSlider.oninput = () => {
    const db = parseFloat(levelSlider.value);
    levelLabel.textContent = db <= -96 ? '−∞' : db.toFixed(1) + ' dB';
  };
  levelSlider.onchange = async () => {
    const db = parseFloat(levelSlider.value);
    await api.putGenerator(gen.id, { level_db: db <= -96 ? -Infinity : db });
    gen.level_db = db;
  };
  levelWrap.appendChild(levelLabel);
  levelWrap.appendChild(levelSlider);
  strip.appendChild(levelWrap);

  const enableBtn = document.createElement('button');
  enableBtn.className = 'gen-enable-btn strip-mute-btn' + (gen.enabled ? ' active' : '');
  enableBtn.textContent = gen.enabled ? 'ON' : 'OFF';
  enableBtn.onclick = async () => {
    const newEnabled = !gen.enabled;
    await api.putGenerator(gen.id, { enabled: newEnabled });
    gen.enabled = newEnabled;
    enableBtn.classList.toggle('active', newEnabled);
    enableBtn.textContent = newEnabled ? 'ON' : 'OFF';
  };
  strip.appendChild(enableBtn);

  // Routing is handled in the matrix tab (generator rows)

  const delBtn = document.createElement('button');
  delBtn.className = 'vca-delete-btn gen-delete-btn';
  delBtn.textContent = '×';
  delBtn.title = 'Delete generator';
  delBtn.onclick = async () => {
    if (!confirm(`Delete generator "${gen.name}"?`)) return;
    await api.deleteGenerator(gen.id);
    st.removeGenerator(gen.id);
    strip.remove();
  };
  strip.appendChild(delBtn);

  return strip;
}

function _showAddGenDialog() {
  const name = prompt('Generator name:');
  if (!name) return;
  const typeStr = prompt('Type (sine / white_noise / pink_noise / freq_sweep):', 'sine') ?? 'sine';
  const body = { name, gen_type: typeStr, freq_hz: 1000, level_db: -20, enabled: false };
  if (typeStr === 'freq_sweep') {
    body.sweep_start_hz = 20;
    body.sweep_end_hz = 20000;
    body.sweep_duration_s = 10;
  }
  api.postGenerator(body)
    .then(gen => {
      st.setGenerator(gen);
      const masters = document.getElementById('mixer-masters');
      const strips  = document.querySelector('.mixer-strips');
      if (strips && masters) _renderStrips(strips, masters);
    })
    .catch(e => alert('Failed: ' + e));
}

function _showGenRoutingPopover(gen, genIdx, anchor, evt) {
  document.querySelectorAll('.gen-routing-popover').forEach(p => p.remove());
  const outputs = st.outputList();
  const matrix = st.getGeneratorMatrix ? st.getGeneratorMatrix() : [];
  const gains = matrix[genIdx] ?? [];

  const pop = document.createElement('div');
  pop.className = 'bus-routing-panel gen-routing-popover';
  pop.style.cssText = 'position:fixed;z-index:999;background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:12px;min-width:200px;';
  const rect = anchor.getBoundingClientRect();
  pop.style.top = (rect.bottom + 4) + 'px';
  pop.style.left = rect.left + 'px';

  const title = document.createElement('div');
  title.className = 'bus-routing-title';
  title.textContent = `Route "${gen.name}" to outputs`;
  pop.appendChild(title);

  const list = document.createElement('div');
  list.className = 'bus-routing-list';

  outputs.forEach((out, txIdx) => {
    const row = document.createElement('label');
    row.className = 'bus-route-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const gain = gains[txIdx] ?? -Infinity;
    cb.checked = isFinite(gain) && gain > -96;
    cb.onchange = async () => {
      const newGains = [...(matrix[genIdx] ?? Array(outputs.length).fill(-Infinity))];
      newGains[txIdx] = cb.checked ? 0.0 : -Infinity;
      await api.putGeneratorRouting(gen.id, newGains);
      const mat = st.getGeneratorMatrix ? st.getGeneratorMatrix() : [];
      if (mat[genIdx]) mat[genIdx] = newGains;
      st.setGeneratorMatrix([...mat]);
    };
    const lbl = document.createElement('span');
    lbl.className = 'bus-route-label';
    lbl.textContent = out.name ?? out.id;
    row.appendChild(cb);
    row.appendChild(lbl);
    list.appendChild(row);
  });
  pop.appendChild(list);

  document.body.appendChild(pop);
  evt.stopPropagation();
  const close = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function _buildInputStrip(ch, nextCh) {
  const strip = document.createElement('div');
  strip.className = 'mixer-strip';
  strip.id = `strip-${ch.id}`;

  const chIdx = parseInt(ch.id.replace('rx_', ''), 10);

  // Name row — may include stereo link badge for even-indexed channels
  const nameRow = document.createElement('div');
  nameRow.className = 'strip-name-row';

  const nm = document.createElement('div');
  nm.className = 'strip-name';
  nm.textContent = ch.name ?? ch.id;
  nm.title = ch.id;
  nameRow.appendChild(nm);

  // Inline stereo link button for even-indexed channels (0, 2, 4…)
  if (nextCh && chIdx % 2 === 0) {
    const nextIdx = parseInt(nextCh.id.replace('rx_', ''), 10);
    const link    = st.getStereoLink(chIdx);
    const linked  = !!(link?.linked);

    const btn = document.createElement('button');
    btn.className = 'strip-stereo-btn' + (linked ? ' linked' : '');
    btn.title = linked ? `Unlink stereo pair ${chIdx + 1}/${nextIdx + 1}` : `Link as stereo ${chIdx + 1}/${nextIdx + 1}`;
    btn.textContent = '⛓';
    btn.onclick = async (e) => {
      e.stopPropagation();
      try {
        if (linked) {
          await api.deleteStereoLink(chIdx);
          st.setStereoLinks(st.state.stereoLinks.filter(sl => sl.left_channel !== chIdx));
          btn.classList.remove('linked');
          btn.title = `Link as stereo ${chIdx + 1}/${nextIdx + 1}`;
        } else {
          await api.postStereoLink(chIdx, nextIdx);
          const sl = { left_channel: chIdx, right_channel: nextIdx, linked: true, pan: 0.0 };
          const existing = st.state.stereoLinks.filter(s => s.left_channel !== chIdx);
          st.setStereoLinks([...existing, sl]);
          btn.classList.add('linked');
          btn.title = `Unlink stereo pair ${chIdx + 1}/${nextIdx + 1}`;
        }
      } catch(e) { toast(e.message, true); }
    };
    nameRow.appendChild(btn);
  }

  strip.appendChild(nameRow);

  // Mute button
  const muteBtn = document.createElement('button');
  muteBtn.className = 'strip-mute-btn' + (ch.enabled === false ? ' active' : '');
  muteBtn.textContent = 'MUTE';
  muteBtn.title = ch.enabled === false ? 'Unmute channel' : 'Mute channel';
  muteBtn.onclick = async () => {
    const nowMuted = muteBtn.classList.contains('active');
    try {
      await api.putInputEnabled(chIdx, nowMuted); // nowMuted=true means currently muted → enable
      muteBtn.classList.toggle('active', !nowMuted);
      muteBtn.title = !nowMuted ? 'Unmute channel' : 'Mute channel';
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(muteBtn);

  // Solo button
  const soloBtn = document.createElement('button');
  soloBtn.className = 'mixer-solo-btn';
  soloBtn.id = `solo-${ch.id}`;
  soloBtn.textContent = 'S';
  soloBtn.title = 'Solo (PFL)';
  soloBtn.setAttribute('aria-label', `Solo ${ch.name ?? ch.id}`);

  // Initial state
  if (st.state.soloSet.has(ch.id)) soloBtn.classList.add('active');

  // Disable if no monitor device configured
  if (!st.state.system.monitor_device) {
    soloBtn.disabled = true;
    soloBtn.title = 'Configure monitor output in System settings';
  }

  soloBtn.onclick = async (e) => {
    if (!st.state.system.monitor_device) {
      toast('Configure monitor device in System settings', true);
      return;
    }
    try {
      if (e.ctrlKey || e.metaKey) {
        // Exclusive solo: solo only this channel
        await api.putSolo([chIdx]);
      } else {
        // Additive toggle
        await api.toggleSolo(chIdx);
      }
    } catch(err) {
      console.error('Solo error:', err);
      toast('Solo error: ' + err.message, true);
    }
  };
  strip.appendChild(soloBtn);

  // Polarity invert (Ø) button
  const initInvert = !!(ch.dsp?.polarity?.invert);
  const polBtn = document.createElement('button');
  polBtn.className = 'mixer-polarity-btn' + (initInvert ? ' active' : '');
  polBtn.textContent = 'Ø';
  polBtn.title = 'Invert polarity';
  polBtn.dataset.invert = initInvert ? '1' : '0';
  polBtn.onclick = async () => {
    const newInvert = polBtn.dataset.invert !== '1';
    try {
      await api.putInputPolarity(chIdx, newInvert);
      polBtn.dataset.invert = newInvert ? '1' : '0';
      polBtn.classList.toggle('active', newInvert);
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(polBtn);

  // VU meter
  const meter = document.createElement('div');
  meter.className = 'strip-meter';
  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  bar.id = `vu-bar-${ch.id}`;
  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  peak.id = `vu-peak-${ch.id}`;
  const hold = document.createElement('div');
  hold.className = 'strip-meter-peak-hold';
  hold.id = `vu-hold-${ch.id}`;
  const clipBadge = document.createElement('div');
  clipBadge.className = 'strip-clip-badge';
  clipBadge.id = `clip-badge-${ch.id}`;
  clipBadge.textContent = 'CLIP';
  meter.appendChild(bar);
  meter.appendChild(peak);
  meter.appendChild(hold);
  meter.appendChild(clipBadge);

  // Gain fader label
  const vol = st.state.channels.get(ch.id)?.gain_db ?? 0;
  const dbLabel = document.createElement('div');
  dbLabel.className = 'strip-fader-label strip-fader-label-editable';
  dbLabel.id = `mix-lbl-${ch.id}`;
  dbLabel.textContent = _db(vol);
  strip.appendChild(dbLabel);

  // Fader
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.min = 0; fader.max = 1000; fader.step = 1;
  fader.value = st.dbToSlider(vol);
  let fTimer;
  fader.oninput = () => {
    const db = st.sliderToDb(+fader.value);
    dbLabel.textContent = _db(db);
    const chanState = st.state.channels.get(ch.id);
    if (chanState) chanState.gain_db = db;
    if (chanState?.dsp?.am?.params) chanState.dsp.am.params.gain_db = db;
    clearTimeout(fTimer);
    fTimer = setTimeout(() => {
      api.putInputGain(chIdx, db).catch(e => toast(e.message, true));
    }, 80);
  };

  // Double-click dB label to type exact value
  dbLabel.ondblclick = () => {
    const curDb = st.sliderToDb(+fader.value);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = isFinite(curDb) ? curDb.toFixed(1) : '-30';
    inp.min = -30; inp.max = 12; inp.step = 0.1;
    inp.className = 'strip-fader-entry';
    dbLabel.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => {
      const db = Math.max(-30, Math.min(12, parseFloat(inp.value) || 0));
      fader.value = st.dbToSlider(db);
      dbLabel.textContent = _db(db);
      inp.replaceWith(dbLabel);
      api.putInputGain(chIdx, db).catch(e => toast(e.message, true));
    };
    inp.onblur = commit;
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') inp.replaceWith(dbLabel);
    };
  };

  // Long-press (500ms) on label to edit — same logic as dblclick
  // Only cancel on significant movement (>8px) to avoid touchscreen jitter canceling the timer
  dbLabel.addEventListener('pointerdown', e => {
    _pressStartX = e.clientX; _pressStartY = e.clientY;
    _pressTimer = setTimeout(() => { dbLabel.ondblclick?.call(dbLabel); }, 500);
  });
  dbLabel.addEventListener('pointerup', () => clearTimeout(_pressTimer));
  dbLabel.addEventListener('pointercancel', () => clearTimeout(_pressTimer));
  dbLabel.addEventListener('contextmenu', e => e.preventDefault());
  dbLabel.addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - _pressStartX, e.clientY - _pressStartY) > 8) clearTimeout(_pressTimer);
  });

  // Fader + meter side by side
  const fmWrap = document.createElement('div');
  fmWrap.className = 'mixer-fader-meter-wrap';
  // Scale labels column (left of meter)
  const scaleCol = document.createElement('div');
  scaleCol.className = 'strip-vu-scale';
  [0, -6, -12, -18, -30].forEach(db => {
    const lbl = document.createElement('span');
    lbl.style.bottom = (db >= 0 ? 100 : Math.round(((db + 60) / 60) * 100)) + '%';
    lbl.textContent = db === 0 ? '0' : String(db);
    scaleCol.appendChild(lbl);
  });
  fmWrap.appendChild(scaleCol);
  fmWrap.appendChild(meter);
  fmWrap.appendChild(fader);
  strip.appendChild(fmWrap);

  // DSP badge row — AM hidden when not active; all other blocks always shown
  const dspRow = document.createElement('div');
  dspRow.className = 'strip-dsp-row';
  const dsp = ch.dsp ?? {};
  Object.keys(dsp).forEach(blk => {
    const block = dsp[blk];

    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    if (block.bypassed) btn.classList.add('byp');
    btn.textContent = colour.label ?? blk.toUpperCase();
    btn.title = blk.toUpperCase();
    btn.dataset.block = blk;
    btn.dataset.ch = ch.id;
    btn.style.background = colour.bg;
    btn.style.color = colour.fg;
    btn.onclick = () => openPanel(blk, ch.id, btn);
    dspRow.appendChild(btn);
  });
  strip.appendChild(dspRow);

  // Zone route buttons
  const zoneRow = document.createElement('div');
  zoneRow.className = 'strip-zone-row';
  st.zoneList().forEach((zone, zi) => {
    const color = st.getZoneColour(zone.colour_index ?? zi);
    const btn = document.createElement('button');
    btn.className = 'strip-zone-btn';
    btn.style.setProperty('--zone-card-color', color);
    btn.textContent = zone.name ?? zone.id;
    btn.dataset.active = _hasZoneRoute(ch.id, zone) ? '1' : '0';
    if (btn.dataset.active === '1') btn.classList.add('active');
    btn.onclick = async () => {
      const active = btn.dataset.active === '1';
      try {
        if (active) {
          for (const txId of (zone.tx_ids ?? [])) {
            await api.deleteRoute(`${ch.id}|${txId}`);
            st.removeRoute(ch.id, txId);
          }
        } else {
          for (const txId of (zone.tx_ids ?? [])) {
            const r = await api.postRoute(ch.id, txId, 'local');
            st.setRoute({ route_type: 'dante', ...r });
          }
        }
        btn.dataset.active = active ? '0' : '1';
        btn.classList.toggle('active', btn.dataset.active === '1');
      } catch(e) { toast(e.message, true); }
    };
    zoneRow.appendChild(btn);
  });
  strip.appendChild(zoneRow);

  return strip;
}

function _buildBusStrip(bus) {
  const strip = document.createElement('div');
  strip.className = 'mixer-strip bus-strip';
  strip.id = `strip-${bus.id}`;
  strip.dataset.busId = bus.id;

  // Name
  const nm = document.createElement('div');
  nm.className = 'strip-name';
  nm.textContent = bus.name ?? bus.id;
  nm.title = bus.id;
  strip.appendChild(nm);

  // Mute button
  const muteBtn = document.createElement('button');
  const initMuted = bus.muted ?? false;
  muteBtn.className = 'strip-mute-btn' + (initMuted ? ' active' : '');
  muteBtn.textContent = 'MUTE';
  muteBtn.title = initMuted ? 'Unmute bus' : 'Mute bus';
  muteBtn.onclick = async () => {
    const nowMuted = muteBtn.classList.contains('active');
    try {
      await api.setBusMute(bus.id, !nowMuted);
      muteBtn.classList.toggle('active', !nowMuted);
      muteBtn.title = !nowMuted ? 'Unmute bus' : 'Mute bus';
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(muteBtn);

  // VU meter
  const meter = document.createElement('div');
  meter.className = 'strip-meter';
  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  bar.id = `vu-bar-${bus.id}`;
  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  peak.id = `vu-peak-${bus.id}`;
  const hold = document.createElement('div');
  hold.className = 'strip-meter-peak-hold';
  hold.id = `vu-hold-${bus.id}`;
  meter.appendChild(bar);
  meter.appendChild(peak);
  meter.appendChild(hold);

  // Gain fader label
  const vol = bus.dsp?.am?.params?.gain_db ?? 0;
  const dbLabel = document.createElement('div');
  dbLabel.className = 'strip-fader-label strip-fader-label-editable';
  dbLabel.id = `mix-lbl-${bus.id}`;
  dbLabel.textContent = _db(vol);
  strip.appendChild(dbLabel);

  // Fader
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.min = 0; fader.max = 1000; fader.step = 1;
  fader.value = st.dbToSlider(vol);
  let fTimer;
  fader.oninput = () => {
    const db = st.sliderToDb(+fader.value);
    dbLabel.textContent = _db(db);
    const busState = st.state.buses.get(bus.id);
    if (busState?.dsp?.am?.params) busState.dsp.am.params.gain_db = db;
    clearTimeout(fTimer);
    fTimer = setTimeout(() => {
      api.setBusGain(bus.id, db).catch(e => toast(e.message, true));
    }, 80);
  };

  // Double-click dB label to type exact value
  dbLabel.ondblclick = () => {
    const curDb = st.sliderToDb(+fader.value);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = isFinite(curDb) ? curDb.toFixed(1) : '-30';
    inp.min = -30; inp.max = 12; inp.step = 0.1;
    inp.className = 'strip-fader-entry';
    dbLabel.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => {
      const db = Math.max(-30, Math.min(12, parseFloat(inp.value) || 0));
      fader.value = st.dbToSlider(db);
      dbLabel.textContent = _db(db);
      inp.replaceWith(dbLabel);
      api.setBusGain(bus.id, db).catch(e => toast(e.message, true));
    };
    inp.onblur = commit;
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') inp.replaceWith(dbLabel);
    };
  };

  // Long-press (500ms) on label to edit
  dbLabel.addEventListener('pointerdown', e => {
    _pressStartX = e.clientX; _pressStartY = e.clientY;
    _pressTimer = setTimeout(() => { dbLabel.ondblclick?.call(dbLabel); }, 500);
  });
  dbLabel.addEventListener('pointerup', () => clearTimeout(_pressTimer));
  dbLabel.addEventListener('pointercancel', () => clearTimeout(_pressTimer));
  dbLabel.addEventListener('contextmenu', e => e.preventDefault());
  dbLabel.addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - _pressStartX, e.clientY - _pressStartY) > 8) clearTimeout(_pressTimer);
  });

  // Fader + meter side by side
  const fmWrap = document.createElement('div');
  fmWrap.className = 'mixer-fader-meter-wrap';
  const scaleCol = document.createElement('div');
  scaleCol.className = 'strip-vu-scale';
  [0, -6, -12, -18, -30].forEach(db => {
    const lbl = document.createElement('span');
    lbl.style.bottom = (db >= 0 ? 100 : Math.round(((db + 60) / 60) * 100)) + '%';
    lbl.textContent = db === 0 ? '0' : String(db);
    scaleCol.appendChild(lbl);
  });
  fmWrap.appendChild(scaleCol);
  fmWrap.appendChild(meter);
  fmWrap.appendChild(fader);
  strip.appendChild(fmWrap);

  // DSP badge row
  const dspRow = document.createElement('div');
  dspRow.className = 'strip-dsp-row';
  const dsp = bus.dsp ?? {};
  Object.keys(dsp).forEach(blk => {
    const block = dsp[blk];

    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    if (block.bypassed) btn.classList.add('byp');
    btn.textContent = colour.label ?? blk.toUpperCase();
    btn.title = blk.toUpperCase();
    btn.dataset.block = blk;
    btn.dataset.ch = bus.id;
    btn.style.background = colour.bg;
    btn.style.color = colour.fg;
    btn.onclick = () => openPanel(blk, bus.id, btn);
    dspRow.appendChild(btn);
  });
  strip.appendChild(dspRow);

  return strip;
}

function _openBusRoutingPanel(bus) {
  // Remove any existing bus routing panel
  const existing = document.getElementById('bus-routing-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'bus-routing-panel';
  panel.className = 'bus-routing-panel';
  panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'z-index:1000;background:var(--bg-panel,#1e1e2e);border:1px solid var(--border,#444);' +
    'border-radius:8px;padding:16px;min-width:260px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.6);';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:none;border:none;' +
    'color:var(--text-muted,#888);cursor:pointer;font-size:14px;padding:4px 6px;';
  closeBtn.onclick = () => panel.remove();
  panel.appendChild(closeBtn);

  // Backdrop dismiss
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:999;';
  backdrop.onclick = () => { panel.remove(); backdrop.remove(); };

  panel.appendChild(buildBusRoutingContent(bus));
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
}

function _buildOutputMaster(out) {
  const txIdx = parseInt(out.id.replace('tx_', ''), 10);
  const color = st.getZoneColour(out.zone_colour_index ?? 0);

  const strip = document.createElement('div');
  strip.className = 'mixer-output-strip';
  strip.id = `strip-${out.id}`;
  strip.style.setProperty('--zone-card-color', color);

  // Name
  const nm = document.createElement('div');
  nm.className = 'zone-master-name';
  nm.textContent = out.name ?? out.id;
  nm.title = out.id + (out.zone_id ? ` (${out.zone_id})` : '');
  strip.appendChild(nm);

  // Mute button — reads live state from st.state.outputs
  const muteBtn = document.createElement('button');
  const curOut = st.state.outputs.get(out.id);
  const initMuted = curOut?.muted ?? false;
  muteBtn.className = 'strip-mute-btn' + (initMuted ? ' active' : '');
  muteBtn.textContent = initMuted ? 'MUTE' : 'mute';
  muteBtn.onclick = async () => {
    const liveOut = st.state.outputs.get(out.id);
    const nowMuted = liveOut?.muted ?? false;
    const newMuted = !nowMuted;
    try {
      await api.putOutputMute(txIdx, newMuted);
      st.setOutput({ ...liveOut, muted: newMuted });
      muteBtn.classList.toggle('active', newMuted);
      muteBtn.textContent = newMuted ? 'MUTE' : 'mute';
    } catch(e) { toast(e.message, true); }
  };
  strip.appendChild(muteBtn);

  // Volume label
  const vol = curOut?.volume_db ?? out.volume_db ?? 0;
  const volLabel = document.createElement('div');
  volLabel.className = 'strip-fader-label strip-fader-label-editable';
  volLabel.id = `mix-lbl-${out.id}`;
  volLabel.textContent = _db(vol);
  strip.appendChild(volLabel);

  // VU meter
  const meter = document.createElement('div');
  meter.className = 'strip-meter';
  const bar = document.createElement('div');
  bar.className = 'strip-meter-bar';
  bar.id = `vu-bar-${out.id}`;
  const peak = document.createElement('div');
  peak.className = 'strip-meter-peak';
  peak.id = `vu-peak-${out.id}`;
  const hold = document.createElement('div');
  hold.className = 'strip-meter-peak-hold';
  hold.id = `vu-hold-${out.id}`;
  const clipBadge = document.createElement('div');
  clipBadge.className = 'strip-clip-badge';
  clipBadge.id = `clip-badge-${out.id}`;
  clipBadge.textContent = 'CLIP';
  meter.appendChild(bar);
  meter.appendChild(peak);
  meter.appendChild(hold);
  meter.appendChild(clipBadge);

  // Fader
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'strip-fader';
  fader.min = 0; fader.max = 1000; fader.step = 1;
  fader.value = st.dbToSlider(vol);
  let ft;
  fader.oninput = () => {
    const db = st.sliderToDb(+fader.value);
    volLabel.textContent = _db(db);
    clearTimeout(ft);
    ft = setTimeout(async () => {
      try {
        await api.putOutputGain(txIdx, db);
        const liveOut = st.state.outputs.get(out.id);
        if (liveOut) st.setOutput({ ...liveOut, volume_db: db });
      } catch(e) { toast(e.message, true); }
    }, 80);
  };

  // Double-click volume label to type exact value
  volLabel.ondblclick = () => {
    const curDb = st.sliderToDb(+fader.value);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = isFinite(curDb) ? curDb.toFixed(1) : '-30';
    inp.min = -30; inp.max = 12; inp.step = 0.1;
    inp.className = 'strip-fader-entry';
    volLabel.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => {
      const db = Math.max(-30, Math.min(12, parseFloat(inp.value) || 0));
      fader.value = st.dbToSlider(db);
      volLabel.textContent = _db(db);
      inp.replaceWith(volLabel);
      api.putOutputGain(txIdx, db).catch(e => toast(e.message, true));
    };
    inp.onblur = commit;
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') inp.replaceWith(volLabel);
    };
  };

  // Long-press (500ms) on label to edit — same logic as dblclick
  volLabel.addEventListener('pointerdown', e => {
    _pressStartX = e.clientX; _pressStartY = e.clientY;
    _pressTimer = setTimeout(() => { volLabel.ondblclick?.call(volLabel); }, 500);
  });
  volLabel.addEventListener('pointerup', () => clearTimeout(_pressTimer));
  volLabel.addEventListener('pointercancel', () => clearTimeout(_pressTimer));
  volLabel.addEventListener('contextmenu', e => e.preventDefault());
  volLabel.addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - _pressStartX, e.clientY - _pressStartY) > 8) clearTimeout(_pressTimer);
  });

  // Fader + meter side by side
  const fmWrap = document.createElement('div');
  fmWrap.className = 'mixer-fader-meter-wrap';
  const scaleColOut = document.createElement('div');
  scaleColOut.className = 'strip-vu-scale';
  [0, -6, -12, -18, -30].forEach(db => {
    const lbl = document.createElement('span');
    lbl.style.bottom = (db >= 0 ? 100 : Math.round(((db + 60) / 60) * 100)) + '%';
    lbl.textContent = db === 0 ? '0' : String(db);
    scaleColOut.appendChild(lbl);
  });
  fmWrap.appendChild(scaleColOut);
  fmWrap.appendChild(meter);
  fmWrap.appendChild(fader);
  strip.appendChild(fmWrap);

  // DSP badge row
  const dspRow = document.createElement('div');
  dspRow.className = 'strip-dsp-row';
  const outDsp = out.dsp ?? curOut?.dsp ?? {};
  Object.keys(outDsp).forEach(blk => {
    const block = outDsp[blk];
    const colour = DSP_COLOURS[blk] ?? { bg: '#333', fg: '#fff', label: blk.toUpperCase() };
    const btn = document.createElement('button');
    btn.className = 'strip-dsp-btn';
    if (!block.enabled || block.bypassed) btn.classList.add('byp');
    btn.textContent = colour.label ?? blk.toUpperCase();
    btn.title = blk.toUpperCase();
    btn.dataset.block = blk;
    btn.dataset.ch = out.id;
    btn.style.background = colour.bg;
    btn.style.color = colour.fg;
    btn.onclick = () => openPanel(blk, out.id, btn);
    dspRow.appendChild(btn);
  });
  strip.appendChild(dspRow);

  return strip;
}

export function updateMetering(rx, tx, bus) {
  if (!rx && !tx && !bus) return;
  const update = (map) => {
    if (!map) return;
    Object.entries(map).forEach(([id, db]) => {
      const bar  = document.getElementById(`vu-bar-${id}`);
      const peak = document.getElementById(`vu-peak-${id}`);
      if (!bar) return;
      const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
      bar.style.height = pct + '%';
      if (peak) {
        peak.style.bottom = pct + '%';
      }
    });
  };
  update(rx);
  update(tx);
  update(bus);
}

function _hasZoneRoute(rxId, zone) {
  return (zone.tx_ids ?? []).some(txId => st.hasRoute(rxId, txId));
}

function _db(v) { if (!isFinite(v)) return '-∞'; return (v>=0?'+':'')+Number(v).toFixed(1); }

function _refreshSoloButtons() {
  document.querySelectorAll('.mixer-solo-btn').forEach(btn => {
    const id = btn.id.replace('solo-', '');
    btn.classList.toggle('active', st.state.soloSet.has(id));
  });
}

function _applySoloVisual() {
  const strips = document.querySelectorAll('.mixer-strip');
  if (st.state.soloSet.size === 0) {
    strips.forEach(s => s.classList.remove('solo-dimmed'));
  } else {
    strips.forEach(s => {
      const id = s.id.replace('strip-', '');
      s.classList.toggle('solo-dimmed', !st.state.soloSet.has(id));
    });
  }
}

function _updateSoloIndicator() {
  const ind = document.getElementById('mixer-solo-indicator');
  if (!ind) return;
  const active = st.state.soloSet.size > 0;
  ind.classList.toggle('active', active);
  if (active) {
    const names = [...st.state.soloSet].map(id => {
      const ch = st.state.channels?.get(id);
      return ch?.name ?? id;
    }).join(', ');
    const clearBtnEl = ind.querySelector('.mixer-clear-solo-btn');
    ind.textContent = `SOLO: ${names}`;
    if (clearBtnEl) ind.appendChild(clearBtnEl);
  }
}

window.addEventListener('pb:buses-changed', () => {
  if (st.state.activeTab === 'mixer') {
    const strips = document.querySelector('.mixer-strips');
    const masters = document.getElementById('mixer-masters');
    if (strips && masters) _renderStrips(strips, masters);
  }
});

window.addEventListener('pb:solo-update', () => {
  _refreshSoloButtons();
  _applySoloVisual();
  _updateSoloIndicator();
});

