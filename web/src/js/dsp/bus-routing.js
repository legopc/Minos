// bus-routing.js — Bus routing panel content builder
import * as st  from '../state.js';
import * as api from '../api.js';
import { toast } from '../toast.js';
import { undo } from '../undo.js';

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
    let currentRouting = Array.isArray(bus.routing) ? [...bus.routing] : [];

    channels.forEach(ch => {
      const rxIdx = parseInt(String(ch.id).replace('rx_', ''), 10);
      if (!Number.isFinite(rxIdx)) return;

      const row = document.createElement('label');
      row.className = 'bus-routing-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!currentRouting[rxIdx];
      cb.dataset.rxIdx = String(rxIdx);

      cb.onchange = async () => {
        const checked = cb.checked;
        const before = [...currentRouting];
        const updated = [...currentRouting];
        while (updated.length <= rxIdx) updated.push(false);
        updated[rxIdx] = checked;

        try {
          await api.setBusRouting(bus.id, updated);
          currentRouting = updated;
          const cur = st.state.buses.get(bus.id) ?? bus;
          st.setBus({ ...cur, routing: [...updated] });

          const busName = cur.name ?? cur.id;
          const rxName = ch.name ?? ch.id;
          undo.push({
            label: `${checked ? 'Route' : 'Unroute'} input→bus: ${rxName} → ${busName}`,
            apply: async () => {
              await api.setBusRouting(bus.id, updated);
              const b = st.state.buses.get(bus.id) ?? bus;
              st.setBus({ ...b, routing: [...updated] });
            },
            revert: async () => {
              await api.setBusRouting(bus.id, before);
              const b = st.state.buses.get(bus.id) ?? bus;
              st.setBus({ ...b, routing: [...before] });
            },
          });

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
