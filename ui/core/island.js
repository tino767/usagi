// The island: the black shape that merges into the top edge of the screen.
// Three modes:
//   inactive  small pill — cursor is away
//   welcome   "= ㅅ =" peek — cursor is nearby (or a module asked for attention)
//   open      expanded panel with the active module — after clicking the face
// Clicking the face while open closes it again.

import { h, svg } from './dom.js';

const SIZES = {
  inactive: { w: 84, h: 30, r: 15 },
  welcome: { w: 236, h: 78, r: 39 },
  open: { w: 512, h: 224, r: 80, ear: 26 },
};
// How close the cursor must be (centered on the island) to wake usagi up.
const ZONES = {
  inactive: { w: 460, h: 190 },
  welcome: { w: 460, h: 190 },
  open: { w: 700, h: 300 },
};
const HIT_PAD = 6;
// Ear size, capped where the island's bottom corner begins so the two curves meet flush.
const EAR = 22;

// Each ear reaches one unit under the island so no hairline seam shows at fractional pixels.
const EAR_L = '<svg class="ear ear-l" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 0H17V16H16A16 16 0 0 0 0 0Z"/></svg>';
const EAR_R = '<svg class="ear ear-r" viewBox="0 0 16 16" aria-hidden="true"><path d="M16 0H-1V16H0A16 16 0 0 1 16 0Z"/></svg>';

export function createIsland({ root, face, bridge }) {
  let mode = 'inactive';
  let openSize = null;
  let attentionUntil = 0;
  let near = false;
  let interactive = false;
  const modeListeners = new Set();

  const peekFace = h('span');
  const tabFace = h('span');
  face.mount(peekFace, 'closed');
  face.mount(tabFace, 'open');

  const pill = h('div', { class: 'pill' });
  const peek = h('button', { class: 'peek', 'aria-label': 'Open usagi', onclick: () => setMode('open') }, peekFace);
  const tab = h('button', { class: 'tab', 'aria-label': 'Close usagi', onclick: () => setMode(near ? 'welcome' : 'inactive') }, tabFace);
  const content = h('div', { class: 'content' });
  const railLeft = h('div', { class: 'rail rail-left' });
  const railRight = h('div', { class: 'rail rail-right' });
  const island = h('div', { class: 'island' }, svg(EAR_L), svg(EAR_R), pill, peek, tab, content, railLeft, railRight);
  const el = h('div', { class: 'usagi', 'data-mode': mode }, island);
  root.append(el);

  island.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode === 'open') setMode('welcome');
  });

  function applySize() {
    const size = mode === 'open' && openSize ? { ...SIZES.open, ...openSize } : SIZES[mode];
    island.style.setProperty('--w', `${size.w}px`);
    island.style.setProperty('--h', `${size.h}px`);
    island.style.setProperty('--r', `${size.r}px`);
    island.style.setProperty('--ear', `${Math.min(size.ear ?? EAR, size.h - size.r)}px`);
  }

  function setMode(next) {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    el.dataset.mode = next;
    applySize();
    if (next === 'open') face.flash(800);
    if (prev === 'open' && document.activeElement && island.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    modeListeners.forEach((fn) => fn(next, prev));
  }

  function hitTest(x, y) {
    if (mode === 'inactive') return false;
    return [island, railLeft, railRight].some((node) => {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      return x >= r.left - HIT_PAD && x <= r.right + HIT_PAD && y >= r.top - HIT_PAD && y <= r.bottom + HIT_PAD;
    });
  }

  // Cursor position comes from the main process (window-relative), so this
  // keeps working while the window is click-through.
  function onCursor({ x, y }) {
    const zone = ZONES[mode];
    const cx = window.innerWidth / 2;
    near = Math.abs(x - cx) <= zone.w / 2 && y >= -8 && y <= zone.h;
    if (mode === 'inactive' && near) setMode('welcome');
    settle();
    const hit = hitTest(x, y);
    if (hit !== interactive) {
      interactive = hit;
      bridge.setInteractive?.(hit);
    }
  }

  function settle() {
    if (mode === 'welcome' && !near && performance.now() > attentionUntil) setMode('inactive');
  }

  bridge.onCursor?.(onCursor);
  applySize();

  return {
    el,
    content,
    railLeft,
    railRight,
    get mode() { return mode; },
    setMode,
    toggle() { setMode(mode === 'open' ? 'inactive' : 'open'); },
    onMode(fn) { modeListeners.add(fn); return () => modeListeners.delete(fn); },
    onWheel(fn) { island.addEventListener('wheel', fn, { passive: true }); },
    setOpenSize(size) { openSize = size; applySize(); },
    // Peek out even though the cursor is away (timer done, notification...).
    attention(ms = 3000) {
      attentionUntil = performance.now() + ms;
      if (mode === 'inactive') setMode('welcome');
    },
    animateContent(kind) {
      content.classList.remove('enter', 'enter-late');
      void content.offsetWidth; // restart the CSS animation
      content.classList.add(kind === 'open' ? 'enter-late' : 'enter');
    },
    frame(bass) {
      pill.style.setProperty('--pulse', (1 + bass * 0.36).toFixed(3));
      settle();
    },
  };
}
