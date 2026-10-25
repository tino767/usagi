// Copy this folder to src/renderer/modules/<your-id>/ (no leading underscore),
// change `id` to match the folder name, restart usagi, then add it from the
// Settings › Modules page. Folders starting with "_" are ignored by the loader.

import { icons } from '../../core/icons.js';

export default {
  id: '_template',               // must equal the folder name
  name: 'Counter',               // shown in Settings › Modules and in aria labels
  description: 'An example module', // tooltip and search text in Settings › Modules
  icon: icons.spark,             // 24×24 SVG string in currentColor, shown in the position rail
  order: 10,                     // default position on first run
  styles: false,                 // true → loads ./style.css next to this file

  // Called once when the module joins the rotation (also at startup), and it
  // keeps living while other modules are showing — timers, listeners and
  // background work belong here.
  create(ctx) {
    const { h, face, store } = ctx;
    // ctx.h(tag, props, ...children)    DOM helper
    // ctx.icons                          shared glyphs
    // ctx.face.bounce(ms)                hop
    // ctx.face.nod(ms)                   small dip
    // ctx.face.tilt(deg)                 hold a tilt (0 to reset)
    // ctx.face.sing(ms)                  open the mouth, closing over ms
    // ctx.island.attention(ms)           peek out even if the cursor is away
    // ctx.island.status(text)            short text in place of the collapsed pill (null clears)
    // ctx.island.progress(0..1)          fill the collapsed pill left to right (null clears)
    // ctx.island.isFront()               is this module open right now?
    // ctx.island.open() / close()
    // ctx.system.media / ctx.system.volume   OS bridge (see ui/core/bridge.js)
    // ctx.audio.kick / ctx.audio.vocal   current 0..1 kick and vocal levels
    // ctx.store.get(key, fallback) / set(key, value)   persisted, scoped to this module

    let count = store.get('count', 0);
    const label = h('span', { style: { fontSize: '40px', fontWeight: '600' } }, String(count));
    const button = h('button', {
      class: 'btn-round',
      'aria-label': 'Add one',
      html: icons.spark,
      onclick: () => {
        count += 1;
        label.textContent = String(count);
        store.set('count', count);
        face.nod();
      },
    });

    const el = h('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' },
    }, label, button);

    return {
      el,              // required: the panel content, 468×96 (the same for every module)
      // rail,         // optional: element for the left side rail (see media)
      show() {},       // optional: became visible
      hide() {},       // optional: hidden (island closed or scrolled away)
      destroy() {},    // optional: removed from the rotation — clean up timers/listeners
    };
  },
};
