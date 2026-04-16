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

  const cleanup = () => overlay.remove();
  overlay.querySelector('.modal-cancel').addEventListener('click', cleanup);
  overlay.querySelector('.modal-confirm').addEventListener('click', () => { cleanup(); onConfirm(); });

  // Close on overlay click (outside box)
  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) cleanup();
  });

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') cleanup();
    if (e.key === 'Tab') {
      const focusable = overlay.querySelectorAll('button');
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }
  });

  // Focus confirm button (danger) or cancel by default
  setTimeout(() => overlay.querySelector(danger ? '.modal-confirm' : '.modal-cancel').focus(), 0);
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
  const cleanup = () => overlay.remove();
  const confirm = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    cleanup();
    onConfirm(v);
  };

  overlay.querySelector('.modal-cancel').addEventListener('click', cleanup);
  overlay.querySelector('.modal-confirm').addEventListener('click', confirm);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirm();
    if (e.key === 'Escape') cleanup();
  });

  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) cleanup();
  });

  setTimeout(() => { input.focus(); input.select(); }, 0);
}
