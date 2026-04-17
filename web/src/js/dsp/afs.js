// dsp/afs.js — Automatic Feedback Suppressor panel
import { toggleRow, sliderRow, selectRow, actionBtn, fmtDb } from './common.js';

const BK = 'afs';

export function buildContent(channelId, params, accentColor, { onChange }) {
  const p = Object.assign({
    enabled: false,
    threshold_db: -20,
    hysteresis_db: 6,
    bandwidth_hz: 10,
    max_notches: 6,
    auto_reset: false,
  }, params);

  const el = document.createElement('div');
  el.className = 'dsp-content afs';

  function emit(extra) { onChange(BK, Object.assign({}, p, extra)); }

  el.appendChild(toggleRow('Enable', p.enabled, v => {
    p.enabled = v;
    emit();
  }));

  el.appendChild(sliderRow('Threshold', -60, 0, 1, p.threshold_db, v => (Math.round(v) + ' dB'), v => {
    p.threshold_db = Math.round(v);
    emit();
  }));

  el.appendChild(sliderRow('Hysteresis', 0, 30, 1, p.hysteresis_db, v => (Math.round(v) + ' dB'), v => {
    p.hysteresis_db = Math.round(v);
    emit();
  }));

  el.appendChild(sliderRow('Notch BW', 1, 100, 1, p.bandwidth_hz, v => (Math.round(v) + ' Hz'), v => {
    p.bandwidth_hz = Math.round(v);
    emit();
  }));

  const maxOpts = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ value: String(n), label: String(n) }));
  const { el: maxRow } = selectRow('Max Notches', maxOpts, String(p.max_notches), v => {
    p.max_notches = parseInt(v, 10);
    emit();
  });
  el.appendChild(maxRow);

  el.appendChild(toggleRow('Auto Reset', p.auto_reset, v => {
    p.auto_reset = v;
    emit();
  }));

  const clearBtn = actionBtn('Clear Notches', () => emit({ reset_notches: true }));
  clearBtn.style.margin = '6px 0';
  el.appendChild(clearBtn);

  return el;
}
