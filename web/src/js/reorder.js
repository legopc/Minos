import { undo } from './undo.js';

const STORAGE_PREFIX = 'patchbox.order.';

export function saveOrder(key, ids) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(ids)); } catch {}
}

export function loadOrder(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Reorder items in `containerEl` according to stored order.
 * @param {string} key         localStorage key suffix
 * @param {HTMLElement[]} items  live NodeList / array of elements
 * @param {function} getId     item => string id
 */
export function applyOrder(key, items, getId) {
  const saved = loadOrder(key);
  if (!saved || !saved.length) return items;
  const map = new Map(items.map(el => [getId(el), el]));
  const ordered = saved.map(id => map.get(id)).filter(Boolean);
  const rest = items.filter(el => !saved.includes(getId(el)));
  const sorted = [...ordered, ...rest];
  // If items are DOM elements already appended, re-order them in their parent
  const parent = items[0]?.parentElement;
  if (parent) sorted.forEach(el => parent.appendChild(el));
  return sorted;
}

/**
 * Make a container drag-to-reorder.
 * @param {HTMLElement} container
 * @param {{itemSelector:string, onReorder:function, orientation:string, getId:function}} opts
 * @returns {function} cleanup
 */
export function makeReorderable(container, {
  itemSelector = '[data-id]',
  onReorder = null,
  orientation = 'horizontal',
  getId = el => el.dataset.id,
} = {}) {
  const isHoriz = orientation !== 'vertical';
  let dragging = null;
  let marker = null;

  function getItems() {
    return Array.from(container.querySelectorAll(':scope > ' + itemSelector));
  }

  // ── Drag handles ──────────────────────────────────────────────
  function ensureHandle(el) {
    if (el.querySelector('.reorder-handle')) return;
    const h = document.createElement('span');
    h.className = 'reorder-handle';
    h.setAttribute('aria-hidden', 'true');
    h.textContent = '⠿';
    h.addEventListener('pointerdown', onPointerDown);
    el.insertBefore(h, el.firstChild);
  }

  function addHandles() {
    getItems().forEach(ensureHandle);
  }

  addHandles();

  // observe new children
  const mo = new MutationObserver(() => addHandles());
  mo.observe(container, { childList: true });

  // ── Pointer drag ──────────────────────────────────────────────
  function createMarker() {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;pointer-events:none;background:var(--color-accent,#6ea7ff);z-index:9999;border-radius:2px;';
    if (isHoriz) { m.style.width = '3px'; m.style.height = '40px'; }
    else         { m.style.width = '100%'; m.style.height = '3px'; }
    document.body.appendChild(m);
    return m;
  }

  function positionMarker(x, y) {
    if (!marker) return;
    const items = getItems().filter(el => el !== dragging);
    let target = null, before = true;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      const mid = isHoriz ? r.left + r.width / 2 : r.top + r.height / 2;
      const pos = isHoriz ? x : y;
      if (pos < mid) { target = item; before = true; break; }
      target = item; before = false;
    }
    if (!target) {
      marker.style.display = 'none'; return;
    }
    const r = target.getBoundingClientRect();
    marker.style.display = 'block';
    if (isHoriz) {
      const lx = before ? r.left : r.right;
      marker.style.left = (lx - 1.5) + 'px';
      marker.style.top  = r.top + 'px';
      marker.style.height = r.height + 'px';
    } else {
      const ly = before ? r.top : r.bottom;
      marker.style.top  = (ly - 1.5) + 'px';
      marker.style.left = r.left + 'px';
      marker.style.width = r.width + 'px';
    }
    marker._target = target;
    marker._before = before;
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const item = e.currentTarget.closest(itemSelector);
    if (!item) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging = item;
    item.classList.add('reorder-dragging');
    marker = createMarker();
    positionMarker(e.clientX, e.clientY);

    function onMove(ev) {
      positionMarker(ev.clientX, ev.clientY);
      // auto-scroll
      const margin = 60;
      const sp = container.parentElement || container;
      const sr = sp.getBoundingClientRect();
      if (isHoriz) {
        if (ev.clientX < sr.left + margin) sp.scrollLeft -= 10;
        else if (ev.clientX > sr.right - margin) sp.scrollLeft += 10;
      } else {
        if (ev.clientY < sr.top + margin) sp.scrollTop -= 10;
        else if (ev.clientY > sr.bottom - margin) sp.scrollTop += 10;
      }
    }

    function onUp() {
      e.currentTarget.releasePointerCapture(e.pointerId);
      item.classList.remove('reorder-dragging');
      if (marker._target) {
        if (marker._before) container.insertBefore(item, marker._target);
        else marker._target.after(item);
      }
      if (marker) { marker.remove(); marker = null; }
      dragging = null;
      const ids = getItems().map(getId);
      // infer key from container's data-reorder-key or a passed key
      const key = container.dataset.reorderKey;
      if (key) saveOrder(key, ids);
      if (onReorder) onReorder(ids);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // ── Keyboard Alt+arrow ────────────────────────────────────────
  function onKeyDown(e) {
    if (!e.altKey) return;
    const fwd  = isHoriz ? 'ArrowRight' : 'ArrowDown';
    const back = isHoriz ? 'ArrowLeft'  : 'ArrowUp';
    if (e.key !== fwd && e.key !== back) return;
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    e.preventDefault();
    if (e.key === fwd && item.nextElementSibling) item.nextElementSibling.after(item);
    else if (e.key === back && item.previousElementSibling) container.insertBefore(item, item.previousElementSibling);
    const ids = getItems().map(getId);
    const key = container.dataset.reorderKey;
    if (key) saveOrder(key, ids);
    if (onReorder) onReorder(ids);
    // SR announcement
    const live = document.getElementById('sr-live-polite');
    if (live) live.textContent = `Moved to position ${getItems().indexOf(item) + 1} of ${getItems().length}`;
    item.focus();
  }

  container.addEventListener('keydown', onKeyDown);

  return function cleanup() {
    mo.disconnect();
    container.removeEventListener('keydown', onKeyDown);
    container.querySelectorAll('.reorder-handle').forEach(h => h.remove());
  };
}
