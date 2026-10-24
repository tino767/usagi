// The built-in "Modules" page. Always last in the rotation; can't be removed.
// Adds/removes modules from the list and holds a couple of preferences.

import { h } from './dom.js';
import { icons } from './icons.js';
import { SYSTEM_ID } from './rotation.js';

export function createManager({ catalog, getRotation, store, contrast }) {
  return {
    id: SYSTEM_ID,
    name: 'Modules',
    icon: icons.grid,

    create(ctx) {
      const count = h('span', { class: 'mgr-count' });
      const grid = h('div', { class: 'mgr-grid' });

      const railBtns = ['auto', 'dark', 'light'].map((value) =>
        h('button', {
          class: 'mgr-seg',
          'aria-label': value === 'auto' ? 'Side rails match the background' : `${value} side rails`,
          onclick: () => { setRail(value); ctx.face.nod(); },
        }, value[0].toUpperCase() + value.slice(1)));

      function setRail(value) {
        store.set('rails', value);
        contrast.set(value);
        railBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent.toLowerCase() === value)));
      }
      setRail(contrast.mode);

      function render() {
        const rotation = getRotation();
        const defs = [...catalog.values()].filter((d) => d.id !== SYSTEM_ID);
        count.textContent = `${rotation.size()} in rotation`;
        grid.replaceChildren(...defs.map((def) => {
          const on = rotation.has(def.id);
          return h('button', {
            class: `mgr-card${on ? ' on' : ''}`,
            'aria-pressed': String(on),
            title: def.description || def.name,
            onclick: () => {
              if (on) rotation.remove(def.id); else { rotation.add(def.id); ctx.face.flash(500); }
              render();
            },
          },
          h('span', { class: 'mgr-top' },
            h('span', { class: 'mgr-icon', html: def.icon || icons.spark }),
            h('span', { class: 'mgr-state' }, on ? 'In rotation' : 'Add')),
          h('span', { class: 'mgr-name' }, def.name));
        }));
      }

      const el = h('div', { class: 'mgr' },
        h('div', { class: 'mgr-head' },
          h('div', { class: 'mgr-title' }, h('span', {}, 'Modules'), count),
          h('div', { class: 'mgr-rails', role: 'group', 'aria-label': 'Side rail color' },
            h('span', { class: 'mgr-label' }, 'Rails'), ...railBtns)),
        grid);

      render();
      return { el, show: render };
    },
  };
}
