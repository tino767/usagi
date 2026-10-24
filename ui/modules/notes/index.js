// Notepad — a scratchpad that persists. usagi nods along as you type.

import { icons } from '../../core/icons.js';

export default {
  id: 'notes',
  name: 'Notepad',
  description: 'A scratchpad that stays put',
  icon: icons.notes,
  order: 3,
  styles: true,

  create(ctx) {
    const { h, face, store } = ctx;
    let saveTimer = 0;

    const count = h('span', { class: 'n-count' });
    const area = h('textarea', {
      id: 'usagi-notes',
      class: 'n-area',
      placeholder: 'Jot something down…',
      spellcheck: 'false',
    });
    area.value = store.get('text', '');

    const el = h('div', { class: 'n-root' },
      h('div', { class: 'n-head' }, h('label', { for: 'usagi-notes' }, 'Notepad'), count),
      area);

    function renderCount() {
      const n = area.value.length;
      count.textContent = `${n} ${n === 1 ? 'char' : 'chars'}`;
    }

    area.addEventListener('input', () => {
      face.nod();
      renderCount();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.set('text', area.value), 300);
    });

    renderCount();
    return {
      el,
      show() { setTimeout(() => area.focus({ preventScroll: true }), 220); },
      hide() { store.set('text', area.value); },
      destroy() { clearTimeout(saveTimer); store.set('text', area.value); },
    };
  },
};
