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

    const area = h('textarea', {
      class: 'n-area',
      'aria-label': 'Notepad',
      placeholder: 'Jot something down…',
      spellcheck: 'false',
    });
    area.value = store.get('text', '');

    const el = h('div', { class: 'n-root' }, area);

    area.addEventListener('input', () => {
      face.nod();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.set('text', area.value), 300);
    });

    return {
      el,
      show() { setTimeout(() => area.focus({ preventScroll: true }), 220); },
      hide() { store.set('text', area.value); },
      destroy() { clearTimeout(saveTimer); store.set('text', area.value); },
    };
  },
};
