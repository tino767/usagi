// The island: the black shape that merges into the top edge of the screen.
// Three modes:
//   inactive  small pill — cursor is away
//   welcome   "= ㅅ =" peek — cursor is nearby (or a module asked for attention)
//   open      expanded panel with the active module — after clicking the face
// Clicking the face while open closes it again.
//
// The face tab is usagi himself: the bottom of his head, with the rest of it
// and his ears hidden above the screen edge. A module can summon him
// (setSummon): while it's showing he slides down into full view, and clicking
// him goes to the module instead of closing. He tucks back up when it's gone.

import { h, svg } from './dom.js';

const SIZES = {
  inactive: { w: 76, h: 30, r: 15 },
  // Same footprint as the open state's face tab, so opening swaps one for the other in place.
  welcome: { w: 168, h: 48, r: 24 },
  // Every module shares this size; only Settings sets its own height (rotation.js).
  open: { w: 512, h: 180, r: 80, ear: 26 },
};
// How close the cursor must be (centered on the island) to wake usagi up.
// Welcome's zone is a little larger so it doesn't flicker at the edge.
const ZONES = {
  inactive: { w: 280, h: 110 },
  welcome: { w: 340, h: 140 },
  open: { w: 700, h: 300 },
};
const HIT_PAD = 6;
// Size on screen at 100% UI scale; Settings › Appearance multiplies it (0.75–1.25).
// The window is sized for the largest scale, so this only ever shrinks the layout.
const BASE_SCALE = 0.8;
// Ear size, capped where the island's bottom corner begins so the two curves meet flush.
const EAR = 22;

// Each ear reaches one unit under the island so no hairline seam shows at fractional pixels.
const EAR_L = '<svg class="ear ear-l" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 0H17V16H16A16 16 0 0 0 0 0Z"/></svg>';
const EAR_R = '<svg class="ear ear-r" viewBox="0 0 16 16" aria-hidden="true"><path d="M16 0H-1V16H0A16 16 0 0 1 16 0Z"/></svg>';
// usagi's ears, standing on top of his head (the head's top is y 200; the extra
// unit tucks under it). Far longer than the island is tall: even summoned, the
// tips stay past the screen edge, so they seem to go on forever. Earrings low
// on the right ear, where they show while he's summoned.
const BUNNY_EARS = `<svg class="bunny-ears" viewBox="0 0 168 201" aria-hidden="true">
  <path fill="var(--paper)" d="M0 24.5A24.5 24.5 0 0 1 24.5 0H33.8A24.5 24.5 0 0 1 58.3 24.5V201H0Z"/>
  <path fill="var(--paper)" d="M109.7 24.5A24.5 24.5 0 0 1 134.2 0H143.5A24.5 24.5 0 0 1 168 24.5V201H109.7Z"/>
  <path fill="var(--tongue)" d="M16.3 200V29.65A12.85 12.85 0 0 1 42 29.65V200Z"/>
  <path fill="var(--tongue)" d="M126 200V29.65A12.85 12.85 0 0 1 151.7 29.65V200Z"/>
  <circle fill="var(--earring)" cx="168" cy="164.7" r="5"/>
  <circle fill="var(--earring)" cx="168" cy="181.5" r="5"/>
</svg>`;
// Delay before he steps out when the island opens, so it has grown around him first.
const SUMMON_DELAY = 160;

export function createIsland({ root, face, bridge }) {
  let mode = 'inactive';
  let openSize = null;
  let attentionUntil = 0;
  let near = false;
  let interactive = false;
  let scale = BASE_SCALE;
  const modeListeners = new Set();
  // background
  let background = 'solid';
  let dotsPulse = true;
  let summon = null; // { label, click } from the showing module
  let summonTimer = 0;

  const peekFace = h('span');
  const tabFace = h('span');
  face.mount(peekFace, 'closed');
  face.mount(tabFace, 'open');

  // glass background: the blurred screen behind the island (drawn by glass.js)
  const frost = h('canvas');
  // The pill doubles as a progress bar (a running timer...): a dim track with a white fill.
  const pillFill = h('div', { class: 'pill-fill' });
  const pill = h('div', { class: 'pill' }, pillFill);
  const progresses = new Map(); // owner → 0..1, same slot rules as statuses
  // Short text a module can show in place of the pill while inactive (a running timer...).
  const status = h('span', { class: 'status' });
  const statuses = new Map(); // owner → text; the oldest still-set owner keeps the slot
  const peek = h('button', { class: 'peek', 'aria-label': 'Open usagi', onclick: () => setMode('open') }, peekFace);
  // the tab is the bottom of his head; the body runs up past the screen edge
  const body = h('span', { class: 'bunny' }, svg(BUNNY_EARS), tabFace);
  const tab = h('button', {
    class: 'tab',
    'aria-label': 'Close usagi',
    onclick: () => (summon && mode === 'open' ? summon.click() : setMode(near ? 'welcome' : 'inactive')),
  }, body);
  const content = h('div', { class: 'content' });
  const railLeft = h('div', { class: 'rail rail-left' });
  const railRight = h('div', { class: 'rail rail-right' });
  const island = h('div', { class: 'island' }, svg(EAR_L), svg(EAR_R), h('div', { class: 'frost' }, frost), pill, status, peek, tab, content, railLeft, railRight);
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

  // Out in full while open with a summoning module; tucked into the tab otherwise.
  function applySummon(delay = 0) {
    clearTimeout(summonTimer);
    const out = mode === 'open' && !!summon;
    tab.setAttribute('aria-label', out ? summon.label : 'Close usagi');
    if (out && delay) summonTimer = setTimeout(() => island.classList.add('summoned'), delay);
    else island.classList.toggle('summoned', out);
  }

  function setMode(next) {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    el.dataset.mode = next;
    applySize();
    applySummon(next === 'open' ? SUMMON_DELAY : 0);
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
    near = Math.abs(x - cx) <= (zone.w * scale) / 2 && y >= -8 && y <= zone.h * scale;
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
    frost,
    get mode() { return mode; },
    setMode,
    toggle() { setMode(mode === 'open' ? 'inactive' : 'open'); },
    onMode(fn) { modeListeners.add(fn); return () => modeListeners.delete(fn); },
    onWheel(fn) { island.addEventListener('wheel', fn, { passive: true }); },
    setOpenSize(size) { openSize = size; applySize(); },
    /** The showing module's { label, click } to bring usagi out in full, or null. */
    setSummon(next) {
      if (next === summon) return;
      summon = next;
      applySummon();
    },
    setScale(value) {
      scale = BASE_SCALE * value;
      el.style.setProperty('--scale', String(scale));
    },
    setStatus(owner, text) {
      if (text) statuses.set(owner, String(text));
      else statuses.delete(owner);
      const shown = statuses.values().next().value ?? '';
      if (status.textContent !== shown) status.textContent = shown;
      island.classList.toggle('has-status', !!shown);
    },
    setProgress(owner, value) {
      if (value == null) progresses.delete(owner);
      else progresses.set(owner, Math.max(0, Math.min(1, Number(value) || 0)));
      const shown = progresses.values().next().value;
      if (shown != null) pill.style.setProperty('--progress', shown.toFixed(4));
      island.classList.toggle('has-progress', shown != null);
    },
    // Peek out even though the cursor is away (timer done, notification...).
    attention(ms = 3000) {
      attentionUntil = performance.now() + ms;
      if (mode === 'inactive') setMode('welcome');
    },
    /** Open-island background: 'solid' | 'dots' | 'gradient' | 'glass', plus the gradient's bottom color. */
    setBackground(kind, color, pulse) {
      background = kind;
      dotsPulse = !!pulse;
      island.dataset.bg = kind;
      if (color) island.style.setProperty('--grad', color);
      if (kind !== 'dots' || !dotsPulse) island.style.removeProperty('--dot-a');
    },
    animateContent(kind) {
      content.classList.remove('enter', 'enter-late');
      void content.offsetWidth; // restart the CSS animation
      content.classList.add(kind === 'open' ? 'enter-late' : 'enter');
    },
    frame(kick) {
      pill.style.setProperty('--pulse', (1 - kick * 0.36).toFixed(3));
      if (background === 'dots' && dotsPulse && mode === 'open') {
        island.style.setProperty('--dot-a', (0.4 + kick * 0.35).toFixed(3));
      }
      settle();
    },
  };
}
