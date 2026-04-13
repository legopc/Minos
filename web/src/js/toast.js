// toast.js — standalone toast notifications (no imports to avoid circular deps)

export function toast(msg, isError = false) {
  const c = document.getElementById('toasts');
  if (!c) { console.warn('[toast]', msg); return; }
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
