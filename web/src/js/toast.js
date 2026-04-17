// toast.js — stacking toast queue with severity support (no imports to avoid circular deps)

const SEVERITIES = {
  info: { ttl: 4000 },
  warn: { ttl: 5000 },
  error: { ttl: 6000 },
  success: { ttl: 3500 }
};

function getContainer() {
  let c = document.getElementById('toasts');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toasts';
    c.className = 'toast-stack';
    document.body.appendChild(c);
  }
  return c;
}

function createToastElement(message, severity) {
  const item = document.createElement('div');
  item.className = `toast-item toast-item--${severity}`;
  item.textContent = message;
  return item;
}

function showToast(message, severity = 'info', ttl = SEVERITIES[severity].ttl) {
  const container = getContainer();
  const item = createToastElement(message, severity);
  container.appendChild(item);
  
  // Trigger reflow to enable CSS transition
  void item.offsetWidth;
  item.classList.add('toast-item--visible');
  
  const timeoutId = setTimeout(() => {
    item.classList.remove('toast-item--visible');
    setTimeout(() => item.remove(), 300);
  }, ttl);
  
  item.addEventListener('click', () => {
    clearTimeout(timeoutId);
    item.classList.remove('toast-item--visible');
    setTimeout(() => item.remove(), 300);
  });
}

export function toast(msg, isErrorOrOpts = false) {
  let severity = 'info';
  let ttl = SEVERITIES.info.ttl;
  
  // Backwards compat: toast(msg, true) → error
  if (typeof isErrorOrOpts === 'boolean') {
    severity = isErrorOrOpts ? 'error' : 'info';
  } else if (typeof isErrorOrOpts === 'object' && isErrorOrOpts !== null) {
    severity = isErrorOrOpts.severity || 'info';
    ttl = isErrorOrOpts.ttl || SEVERITIES[severity].ttl;
  }
  
  showToast(msg, severity, ttl);
}

toast.info = (msg, opts) => showToast(msg, 'info', opts?.ttl || SEVERITIES.info.ttl);
toast.warn = (msg, opts) => showToast(msg, 'warn', opts?.ttl || SEVERITIES.warn.ttl);
toast.error = (msg, opts) => showToast(msg, 'error', opts?.ttl || SEVERITIES.error.ttl);
toast.success = (msg, opts) => showToast(msg, 'success', opts?.ttl || SEVERITIES.success.ttl);
