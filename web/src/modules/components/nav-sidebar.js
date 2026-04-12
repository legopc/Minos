// Nav sidebar enhancement component.
// Adds: collapse state persistence, keyboard shortcut, zone count badges.

import api from '../api.js';

const COLLAPSE_KEY = 'pb_sidebar_collapsed';

export function initSidebar() {
  restoreCollapseState();
  bindKeyboardShortcut();
  loadZoneCounts();
}

// Persist collapse state across reloads
function restoreCollapseState() {
  const collapsed = localStorage.getItem(COLLAPSE_KEY) === 'true';
  document.body.classList.toggle('sidebar-collapsed', collapsed);
}

// Override the toggle button to also persist state
function bindKeyboardShortcut() {
  const btn = document.getElementById('btn-sidebar-toggle');
  if (!btn) return;
  
  // Wrap existing click handler to also save state
  btn.addEventListener('click', () => {
    const isCollapsed = document.body.classList.contains('sidebar-collapsed');
    localStorage.setItem(COLLAPSE_KEY, String(isCollapsed));
  });
  
  // Keyboard shortcut: Ctrl+\ or Cmd+\ toggles sidebar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      document.body.classList.toggle('sidebar-collapsed');
      const isCollapsed = document.body.classList.contains('sidebar-collapsed');
      localStorage.setItem(COLLAPSE_KEY, String(isCollapsed));
    }
  });
}

// Load zone counts and show badges on matrix/inputs/outputs nav items
async function loadZoneCounts() {
  try {
    const cfg = await api.zones.list();
    // cfg is the full config object from /api/v1/config
    // Extract counts — adapt to actual response shape
    const inputCount = cfg?.sources?.length ?? cfg?.input_count ?? 0;
    const outputCount = cfg?.zones?.length ?? cfg?.output_count ?? 0;
    
    setBadge('matrix', `${inputCount}×${outputCount}`);
    setBadge('inputs', String(inputCount));
    setBadge('outputs', String(outputCount));
  } catch (e) {
    // Silent fail — badges are non-critical
  }
}

function setBadge(route, text) {
  const navItem = document.querySelector(`.nav-item[data-route="${route}"]`);
  if (!navItem) return;
  
  let badge = navItem.querySelector('.nav-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    navItem.appendChild(badge);
  }
  badge.textContent = text;
}
