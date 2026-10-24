// The built-in "Modules" page. Always last in the rotation; can't be removed.
// Adds/removes modules from the list and holds the UI scale preference.

import { h } from './dom.js';
import { icons } from './icons.js';
import { SYSTEM_ID } from './rotation.js';

const SCALES = [0.75, 1, 1.25];

export function createManager({ catalog, getRotation, store, setScale }) {
  return {
    id: SYSTEM_ID,
    name: 'Modules',
    icon: icons.grid,

    create(ctx) {
      const count = h('span', { class: 'mgr-count' });
      const grid = h('div', { class: 'mgr-grid' });

      const scaleBtns = SCALES.map((value) =>
        h('button', {
          class: 'mgr-seg',
          'aria-label': `${value * 100}% size`,
          onclick: () => { pickScale(value); ctx.face.nod(); },
        }, `${value * 100}%`));

      const markScale = (value) => scaleBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SCALES[i] === value)));
      function pickScale(value) {
        store.set('scale', value);
        setScale(value);
        markScale(value);
      }
      markScale(store.get('scale', 1));

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
              if (on) rotation.remove(def.id); else { rotation.add(def.id); ctx.face.nod(); }
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
          h('div', { class: 'mgr-scale', role: 'group', 'aria-label': 'UI scale' },
            h('span', { class: 'mgr-label' }, 'Scale'), ...scaleBtns)),
        grid);

      render();
      return { el, show: render };
    },
  };
}
