// dsp/aec.js — Acoustic Echo Cancellation panel
import { outputList } from '../state.js';
import { toggleRow, selectRow } from './common.js';

const BK = 'aec';

export function buildContent(channelId, params, accentColor, { onChange }) {
  const p = Object.assign({ enabled: false, reference_tx_idx: null }, params);
  const el = document.createElement('div');
  el.className = 'dsp-content aec';

  function emit() { onChange(BK, { enabled: p.enabled, reference_tx_idx: p.reference_tx_idx }); }

  el.appendChild(toggleRow('Enable', p.enabled, v => {
    p.enabled = v;
    emit();
  }));

  const txOpts = [{ value: '', label: '— none —' }].concat(
    outputList().map(out => ({
      value: String(parseInt(out.id.replace('tx_', ''), 10)),
      label: out.name ?? out.id
    }))
  );
  const { el: txRow, sel: txSel } = selectRow('Reference TX', txOpts, String(p.reference_tx_idx ?? ''), v => {
    p.reference_tx_idx = v === '' ? null : parseInt(v, 10);
    emit();
  });
  el.appendChild(txRow);

  return el;
}
