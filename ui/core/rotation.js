// The rotation: which modules are in usagi's list, which one is showing,
// scroll-to-switch, and the position rail on the right. A module marked
// `secret` (Ask usagi) is never in the list: pulling usagi down by his face
// shows it as a detour, and scrolling away or closing returns to the list.

import { h } from './dom.js';

export const SYSTEM_ID = 'settings';
const WHEEL_GAP_MS = 380;

export function createRotation({ island, store, catalog, makeCtx }) {
  let order = [];
  let index = 0;
  let currentId = null;
  let visiting = null; // the secret module, while it's showing
  const secretId = [...catalog.values()].find((def) => def.secret)?.id ?? null;
  let lastWheel = 0;
  const instances = new Map();

  const ids = () => [...order, SYSTEM_ID];

  function instance(id) {
    if (!instances.has(id)) {
      const def = catalog.get(id);
      let inst = {};
      try {
        inst = def.create(makeCtx(id)) || {};
      } catch (err) {
        console.error(`[usagi] module "${id}" failed in create()`, err);
        inst = { el: h('div', { class: 'module-error' }, `${def.name} hit an error. Check the console.`) };
      }
      if (!inst.el) inst.el = h('div');
      instances.set(id, inst);
    }
    return instances.get(id);
  }

  function destroy(id) {
    const inst = instances.get(id);
    if (!inst) return;
    try { inst.hide?.(); inst.destroy?.(); } catch (err) { console.error(err); }
    inst.el.remove();
    inst.rail?.remove();
    instances.delete(id);
    if (currentId === id) currentId = null;
  }

  function save() { store.set('rotation', order); }

  // ---- position rail ----
  const railIcon = h('span', { class: 'rail-icon' });
  let dots = [];
  island.railRight.append(railIcon);

  function renderRail(list, id) {
    if (dots.length !== list.length) {
      dots.forEach((d) => d.remove());
      dots = list.map((_, i) => h('button', { class: 'dot', onclick: () => go(i) }, h('span')));
      island.railRight.append(...dots);
    }
    dots.forEach((d, i) => {
      const on = !visiting && i === index;
      d.classList.toggle('on', on);
      d.setAttribute('aria-label', `Show ${catalog.get(list[i])?.name ?? list[i]}`);
      if (on) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
    const icon = catalog.get(id)?.icon ?? '';
    if (railIcon.innerHTML !== icon) {
      railIcon.innerHTML = icon;
      railIcon.classList.remove('pop');
      void railIcon.offsetWidth; // restart the CSS animation
      railIcon.classList.add('pop');
    }
  }

  // dir: 1 = moved to the next module, -1 = the previous (sets which side it slides in from)
  function render({ animate = true, dir = 0 } = {}) {
    const list = ids();
    index = Math.max(0, Math.min(index, list.length - 1));
    const id = visiting ?? list[index];
    const inst = instance(id);
    const open = island.mode === 'open';

    if (id !== currentId) {
      if (open && currentId) instances.get(currentId)?.hide?.();
      island.content.replaceChildren(inst.el);
      island.railLeft.replaceChildren(...(inst.rail ? [inst.rail] : []));
      island.setSummon(inst.summon ?? null);
      currentId = id;
      if (open) {
        inst.show?.();
        if (animate) island.animateContent(dir > 0 ? 'next' : dir < 0 ? 'prev' : 'swap');
      }
    }
    applySize();
    island.pinFace(!!catalog.get(id)?.keepFace);
    renderRail(list, id);
  }

  // Every module shares the open island's size. Only Settings sets its own
  // height (taller home, growing into its pages), through instance.size().
  function applySize() {
    const inst = currentId === SYSTEM_ID ? instances.get(currentId) : null;
    island.setOpenSize(inst?.size?.() || null);
  }

  function go(i, dir = Math.sign(i - index)) { visiting = null; index = i; render({ dir }); }
  function step(dir) {
    // leaving the secret page goes back to the module it was pulled from
    if (visiting) { visiting = null; render({ dir }); return; }
    const n = ids().length;
    go((index + dir + n) % n, dir);
  }

  island.onWheel((e) => {
    if (island.mode !== 'open') return;
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 4) return;
    if (scrollsInside(e.target, island.content, d)) return;
    const now = performance.now();
    if (now - lastWheel < WHEEL_GAP_MS) return;
    lastWheel = now;
    step(d > 0 ? 1 : -1);
  });

  island.onMode((mode, prev) => {
    const inst = instances.get(currentId);
    if (mode === 'open') { inst?.show?.(); island.animateContent('open'); }
    else if (prev === 'open') {
      inst?.hide?.();
      if (visiting) { visiting = null; render({ animate: false }); }
    }
  });

  island.onPull(() => {
    if (!secretId || island.mode !== 'open' || visiting) return;
    visiting = secretId;
    render();
  });

  return {
    start() {
      const saved = store.get('rotation', null);
      const listed = (id) => catalog.has(id) && id !== SYSTEM_ID && !catalog.get(id).secret;
      order = (saved ?? [...catalog.keys()]).filter(listed);
      order.forEach(instance); // create up front so modules can run in the background
      render({ animate: false });
    },
    add(id) {
      if (order.includes(id) || !catalog.has(id) || id === SYSTEM_ID || catalog.get(id).secret) return;
      order.push(id);
      instance(id);
      save();
      index = ids().length - 1;
      render({ animate: false });
    },
    remove(id) {
      if (!order.includes(id)) return;
      order = order.filter((x) => x !== id);
      destroy(id);
      save();
      index = ids().length - 1;
      render({ animate: false });
    },
    has: (id) => order.includes(id),
    size: () => order.length,
    current: () => currentId,
    refreshSize: applySize,
    goTo(id) { const i = ids().indexOf(id); if (i >= 0) go(i); },
    next: () => step(1),
    prev: () => step(-1),
  };
}

// Let scrollable things inside a module (textareas, long lists) scroll
// before the wheel switches modules.
function scrollsInside(target, boundary, dy) {
  for (let el = target; el && el !== boundary; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const oy = getComputedStyle(el).overflowY;
    const scrollable = el.tagName === 'TEXTAREA' || oy === 'auto' || oy === 'scroll';
    if (!scrollable || el.scrollHeight <= el.clientHeight + 1) continue;
    if (dy < 0 && el.scrollTop > 0) return true;
    if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  }
  return false;
}
