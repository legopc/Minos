/**
 * Output Channel Strips Page
 *
 * Renders a horizontally-scrollable row of output channel strips (zones).
 * Each strip includes gain, filtering, EQ, compression, limiting, and delay.
 * Each strip has a dedicated MUTE button above it.
 */

import { ChannelStrip } from '/modules/components/channel-strip.js';
import { matrix, zones, apiErrorMessage } from '/modules/api.js';

export async function render(container) {
  const cleanup = await init(container);
  return cleanup;
}

export async function init(container) {
  // State
  let config = null;
  const stripInstances = [];
  const muteButtonRefs = [];

  try {
    // Fetch config to get zones list
    config = await matrix.get();
    if (!config || !config.zones) {
      throw new Error('No zones in config');
    }

    const outputCount = config.zones.length;

    // Build page structure
    const pageEl = document.createElement('div');
    pageEl.className = 'strips-page';
    container.appendChild(pageEl);

    // Toolbar
    const toolbarEl = document.createElement('div');
    toolbarEl.className = 'strips-toolbar';
    toolbarEl.innerHTML = `
      <h2>OUTPUT CHANNELS</h2>
      <span class="strips-count">${outputCount}</span>
    `;
    pageEl.appendChild(toolbarEl);

    // Scrollable container
    const scrollEl = document.createElement('div');
    scrollEl.className = 'strips-scroll';
    pageEl.appendChild(scrollEl);

    const rowEl = document.createElement('div');
    rowEl.className = 'strips-row';
    scrollEl.appendChild(rowEl);

    // Create strips sequentially
    for (let i = 0; i < outputCount; i++) {
      const zone = config.zones[i];
      const zoneName = zone.name || `Zone ${i + 1}`;

      // Column wrapper
      const colEl = document.createElement('div');
      colEl.className = 'strip-col';

      // Mute button
      const muteBtn = document.createElement('button');
      muteBtn.className = 'strip-mute-btn';
      muteBtn.textContent = zone.muted ? 'MUTED' : 'MUTE';
      muteBtn.setAttribute('data-muted', zone.muted ? 'true' : 'false');
      if (zone.muted) muteBtn.classList.add('active');
      
      // Store reference for state tracking
      muteButtonRefs.push({
        element: muteBtn,
        index: i,
        getMuted: () => muteBtn.getAttribute('data-muted') === 'true'
      });

      // Mute button click handler (closure over i and current state)
      muteBtn.addEventListener('click', async () => {
        const buttonRef = muteButtonRefs[i];
        const currentMuted = buttonRef.getMuted();
        try {
          await zones.setMute(i, !currentMuted);
          // Update button state
          const newMuted = !currentMuted;
          buttonRef.element.setAttribute('data-muted', newMuted ? 'true' : 'false');
          buttonRef.element.textContent = newMuted ? 'MUTED' : 'MUTE';
          if (newMuted) {
            buttonRef.element.classList.add('active');
          } else {
            buttonRef.element.classList.remove('active');
          }
        } catch (err) {
          console.error(`Failed to toggle mute for zone ${i}:`, apiErrorMessage(err));
        }
      });

      colEl.appendChild(muteBtn);

      // Channel strip container
      const stripWrapEl = document.createElement('div');
      stripWrapEl.className = 'strip-wrap';
      colEl.appendChild(stripWrapEl);

      rowEl.appendChild(colEl);

      // Load and initialize strip
      const strip = new ChannelStrip(stripWrapEl, i, 'output', zoneName);
      await strip.load();
      stripInstances.push(strip);
    }
  } catch (err) {
    const errorEl = document.createElement('div');
    errorEl.className = 'strips-error';
    errorEl.textContent = `Error loading outputs: ${apiErrorMessage(err)}`;
    container.appendChild(errorEl);
  }

  // Cleanup function
  return () => {
    stripInstances.forEach(strip => {
      try {
        strip.destroy();
      } catch (e) {
        console.error('Error destroying strip:', e);
      }
    });
    container.innerHTML = '';
  };
}
