// shortcuts.js — global keyboard shortcut handler

function _isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

export function setupShortcuts() {
  document.addEventListener('keydown', e => {
    if (_isTypingTarget(e.target)) return;

    const key = (e.key || '').toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    // Cmd/Ctrl+S: Save scene
    if (mod && key === 's') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('shortcut:save-scene'));
      return;
    }

    // Cmd/Ctrl+Z: Undo
    if (mod && !e.shiftKey && key === 'z') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('shortcut:undo'));
      return;
    }

    // Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y: Redo
    if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('shortcut:redo'));
      return;
    }

    // ESC: Clear solo + close DSP panels
    if (e.key === 'Escape') {
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

    // 1–8: Quick load favourite scene by index
    if (!e.ctrlKey && !e.altKey && !e.metaKey && key >= '1' && key <= '8') {
      const idx = parseInt(key, 10) - 1;
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
      <tr><td class="shortcut-key">Ctrl/Cmd+S</td><td>Save scene snapshot</td></tr>
      <tr><td class="shortcut-key">Ctrl/Cmd+Z</td><td>Undo</td></tr>
      <tr><td class="shortcut-key">Ctrl/Cmd+Shift+Z</td><td>Redo</td></tr>
      <tr><td class="shortcut-key">Ctrl/Cmd+Y</td><td>Redo</td></tr>
      <tr><td class="shortcut-key">Esc</td><td>Clear solo / close panels</td></tr>
      <tr><td class="shortcut-key">?</td><td>Show this help</td></tr>
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
