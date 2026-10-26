// Ask usagi — a magic 8-ball. While this module is showing, usagi steps out of
// his tab in full view; click him with a question in mind and his face bobs
// down and up (yes), slides side to side (no) or blinks, puzzled, with a "…"
// between his ears (maybe). The prompt sits on his left, his answer on his right.

import { icons } from '../../core/icons.js';

const ANSWERS = ['yes', 'no', 'maybe'];
const WORDS = { yes: 'Yes!', no: 'Nope.', maybe: 'Maybe…' };
const HINT = '…then click me';

export default {
  id: 'ask',
  name: 'Ask usagi',
  description: 'Yes, no or maybe: click usagi for an answer',
  icon: icons.ask,
  order: 4,
  styles: true,

  create(ctx) {
    const { h, face } = ctx;
    let busy = 0; // timeout while he's answering; clicks wait for it
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    const said = h('span', { class: 'ask-said', 'aria-live': 'polite' }, HINT);
    const el = h('div', { class: 'ask-root' },
      h('span', { class: 'ask-prompt' }, 'Think of a yes or no question'),
      h('span', { 'aria-hidden': 'true' }), // usagi stands here
      said);

    // Each plays the answer and returns how long it takes.
    const answers = {
      yes() {
        face.nod(220, 5);
        later(() => face.nod(220, 5), 400);
        return 800;
      },
      no() {
        face.shake(900);
        return 950;
      },
      maybe() {
        face.blink(2);
        face.think(1800);
        later(() => face.blink(), 1500);
        return 1900;
      },
    };

    function ask() {
      if (busy) return;
      const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
      said.textContent = WORDS[answer];
      said.classList.add('answered');
      said.classList.remove('pop');
      void said.offsetWidth; // restart the CSS animation
      said.classList.add('pop');
      busy = setTimeout(() => { busy = 0; }, answers[answer]());
    }

    return {
      el,
      summon: { label: 'Ask usagi', click: ask },
      // a fresh question each visit
      show() { said.textContent = HINT; said.classList.remove('answered', 'pop'); },
      destroy() { clearTimeout(busy); timers.forEach(clearTimeout); },
    };
  },
};
