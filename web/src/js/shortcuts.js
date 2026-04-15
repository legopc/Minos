// shortcuts.js — global keyboard shortcut handler

export function setupShortcuts() {
  document.addEventListener('keydown', e => {
    // Skip if user is typing in an input/textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    // Ctrl+S: Save scene
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('shortcut:save-scene'));
      return;
    }

    // ESC: Clear solo + close DSP panels
    if (e.key === 'Escape') {
      // Don't preventDefault — let modals handle ESC first via their own listeners
      window.dispatchEvent(new CustomEvent('shortcut:clear-solo'));
      window.dispatchEvent(new CustomEvent('shortcut:close-panels'));
      return;
    }

    // ?: Show shortcuts help
    if (e.key === '?') {
      e.preventDefault();
      _showHelp();
      return;
    }

    // Ctrl+Z: Undo last route
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('shortcut:undo-route'));
      return;
    }

    // 1–8: Quick load favourite scene by index
    if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= '1' && e.key <= '8') {
      const idx = parseInt(e.key) - 1;
      window.dispatchEvent(new CustomEvent('shortcut:load-scene', { detail: { index: idx } }));
      return;
    }
  });
}

function _showHelp() {
  document.getElementById('shortcuts-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'shortcuts-overlay';
  overlay.className = 'shortcuts-overlay';

  const modal = document.createElement('div');
  modal.className = 'shortcuts-modal';
  modal.innerHTML = `
    <div class="shortcuts-header">
      <span class="shortcuts-title">Keyboard Shortcuts</span>
      <button class="shortcuts-close" aria-label="Close">✕</button>
    </div>
    <table class="shortcuts-table">
      <tr><td class="shortcut-key">Ctrl+S</td><td>Save scene snapshot</td></tr>
      <tr><td class="shortcut-key">Esc</td><td>Clear solo / close panels</td></tr>
      <tr><td class="shortcut-key">?</td><td>Show this help</td></tr>
      <tr><td class="shortcut-key">Ctrl+Z</td><td>Undo last route change</td></tr>
      <tr><td class="shortcut-key">1 – 8</td><td>Quick-load favourite scene</td></tr>
    </table>
  `;

  overlay.appendChild(modal);
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('.shortcuts-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); });

  document.body.appendChild(overlay);
  modal.querySelector('.shortcuts-close').focus();
}
