// bus-routing.js — Bus routing panel content builder
import * as st  from '../state.js';
import * as api from '../api.js';
import { toast } from '../toast.js';

/**
 * Builds a checklist UI showing all RX channels and whether each feeds this bus.
 * Toggling a checkbox calls api.setBusRouting to update the server.
 */
export function buildBusRoutingContent(bus) {
  const wrap = document.createElement('div');
  wrap.className = 'bus-routing-content';

  const heading = document.createElement('div');
  heading.className = 'bus-routing-heading';
  heading.textContent = `Sources → ${bus.name ?? bus.id}`;
  wrap.appendChild(heading);

  const hint = document.createElement('div');
  hint.className = 'bus-routing-hint';
  hint.textContent = 'Select RX inputs that feed this bus:';
  wrap.appendChild(hint);

  const list = document.createElement('div');
  list.className = 'bus-routing-list';

  const channels = st.channelList();
  if (!channels.length) {
    const empty = document.createElement('div');
    empty.className = 'bus-routing-empty';
    empty.textContent = 'No RX channels available.';
    list.appendChild(empty);
  } else {
    const currentRouting = Array.isArray(bus.routing) ? bus.routing : [];

    channels.forEach(ch => {
      const row = document.createElement('label');
      row.className = 'bus-routing-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = currentRouting.includes(ch.id);
      cb.dataset.chId = ch.id;

      cb.onchange = async () => {
        const checked = cb.checked;
        const updated = checked
          ? [...currentRouting.filter(id => channels.some(c => c.id === id)), ch.id]
          : currentRouting.filter(id => id !== ch.id);

        try {
          await api.setBusRouting(bus.id, updated);
          if (checked) currentRouting.push(ch.id);
          else { const i = currentRouting.indexOf(ch.id); if (i >= 0) currentRouting.splice(i, 1); }
        } catch(e) {
          cb.checked = !checked;
          toast(e.message, true);
        }
      };

      const lbl = document.createElement('span');
      lbl.textContent = ch.name ?? ch.id;
      lbl.title = ch.id;

      row.appendChild(cb);
      row.appendChild(lbl);
      list.appendChild(row);
    });
  }

  wrap.appendChild(list);
  return wrap;
}
