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
