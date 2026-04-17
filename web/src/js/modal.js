// modal.js — reusable confirmation modal
export function confirmModal({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm }) {
  // Remove any existing modal
  document.getElementById('pb-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pb-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'pb-modal-title');
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="modal-title" id="pb-modal-title">${title}</h2>
      <p class="modal-body">${body}</p>
      <div class="modal-actions">
        <button class="modal-cancel">${cancelLabel}</button>
        <button class="modal-confirm${danger ? ' btn-danger' : ''}">${confirmLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Store previous focus to restore after modal closes
  const previouslyFocused = document.activeElement;

  const cleanup = () => {
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };

  overlay.querySelector('.modal-cancel').addEventListener('click', cleanup);
  overlay.querySelector('.modal-confirm').addEventListener('click', () => { cleanup(); onConfirm(); });

  // Close on overlay click (outside box)
  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) cleanup();
  });

  // Focus trap and keyboard handling
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cleanup();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(overlay.querySelectorAll('button'));
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  });

  // Focus first button (cancel for safety, confirm for danger)
  setTimeout(() => {
    const targetBtn = overlay.querySelector(danger ? '.modal-confirm' : '.modal-cancel');
    if (targetBtn) targetBtn.focus();
  }, 0);
}

/** Modal with a text input. onConfirm(value) called with non-empty trimmed value. */
export function inputModal({ title, placeholder = '', defaultValue = '', confirmLabel = 'Save', cancelLabel = 'Cancel', onConfirm }) {
  document.getElementById('pb-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pb-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'pb-modal-title');
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="modal-title" id="pb-modal-title">${title}</h2>
      <input class="modal-input" type="text" placeholder="${placeholder}" value="${defaultValue}" autocomplete="off" spellcheck="false">
      <div class="modal-actions">
        <button class="modal-cancel">${cancelLabel}</button>
        <button class="modal-confirm">${confirmLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.modal-input');
  const previouslyFocused = document.activeElement;

  const cleanup = () => {
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };

  const confirm = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    cleanup();
    onConfirm(v);
  };

  overlay.querySelector('.modal-cancel').addEventListener('click', cleanup);
  overlay.querySelector('.modal-confirm').addEventListener('click', confirm);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  });

  // Focus trap for input modal
  const buttons = Array.from(overlay.querySelectorAll('button'));
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      if (buttons.length === 0) return;
      const focusable = [input, ...buttons];
      const currentIdx = focusable.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (currentIdx <= 0) {
          e.preventDefault();
          focusable[focusable.length - 1].focus();
        }
      } else {
        if (currentIdx >= focusable.length - 1) {
          e.preventDefault();
          focusable[0].focus();
        }
      }
    }
  });

  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) cleanup();
  });

  setTimeout(() => { input.focus(); input.select(); }, 0);
}
