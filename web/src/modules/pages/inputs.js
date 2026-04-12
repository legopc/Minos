import { ChannelStrip } from '/modules/components/channel-strip.js';
import { matrix, apiErrorMessage } from '/modules/api.js';

export async function init(container) {
  const strips = [];   // track for cleanup

  container.innerHTML = `
    <div class="strips-page">
      <div class="strips-toolbar">
        <span class="strips-toolbar-title">INPUT CHANNELS</span>
        <span class="strips-count" id="inputs-count">—</span>
      </div>
      <div class="strips-scroll">
        <div class="strips-row" id="inputs-row">
          <div class="strips-loading">Loading…</div>
        </div>
      </div>
    </div>
  `;

  try {
    const config = await matrix.get();
    const sources = config.sources || [];
    const row = container.querySelector('#inputs-row');
    const countEl = container.querySelector('#inputs-count');
    
    countEl.textContent = `${sources.length} ch`;
    
    if (sources.length === 0) {
      row.innerHTML = '<div class="strips-empty">No input channels configured</div>';
    } else {
      row.innerHTML = '';
      for (let i = 0; i < sources.length; i++) {
        const wrapEl = document.createElement('div');
        row.appendChild(wrapEl);
        const strip = new ChannelStrip(wrapEl, i, 'input', sources[i].name || `IN ${i + 1}`);
        await strip.load();
        strips.push(strip);
      }
    }
  } catch (err) {
    const row = container.querySelector('#inputs-row');
    if (row) row.innerHTML = `<div class="strips-empty strips-error">Failed to load: ${err.message}</div>`;
  }

  return function cleanup() {
    strips.forEach(s => s.destroy());
    strips.length = 0;
  };
}
