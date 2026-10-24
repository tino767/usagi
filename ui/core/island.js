// The island: the black shape that merges into the top edge of the screen.
// Three modes:
//   inactive  small pill — cursor is away
//   welcome   "= ㅅ =" peek — cursor is nearby (or a module asked for attention)
//   open      expanded panel with the active module — after clicking the face
// Clicking the face while open closes it again.

import { h, svg } from './dom.js';

const SIZES = {
  inactive: { w: 76, h: 30, r: 15 },
  // Same footprint as the open state's face tab, so opening swaps one for the other in place.
  welcome: { w: 168, h: 48, r: 24 },
  open: { w: 512, h: 224, r: 80, ear: 26 },
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
// Face auto-hide ("tuck"): while open, the face tab slides up off screen and the
// island loses this much height. Hovering the top strip brings it back.
const TUCK = 40;
const TAB_W = 168;
// Reveal zone around the face's spot, in design px (before scale).
const REVEAL_PAD_X = 60;
const REVEAL_H = { shown: 56, tucked: 24 };

// Each ear reaches one unit under the island so no hairline seam shows at fractional pixels.
const EAR_L = '<svg class="ear ear-l" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 0H17V16H16A16 16 0 0 0 0 0Z"/></svg>';
const EAR_R = '<svg class="ear ear-r" viewBox="0 0 16 16" aria-hidden="true"><path d="M16 0H-1V16H0A16 16 0 0 1 16 0Z"/></svg>';

export function createIsland({ root, face, bridge }) {
  let mode = 'inactive';
  let openSize = null;
  let attentionUntil = 0;
  let near = false;
  let interactive = false;
  let scale = BASE_SCALE;
  const modeListeners = new Set();
  // face auto-hide
  let faceMode = 'always';
  let faceDelay = 5000;
  let facePinned = false; // the current module keeps the face up (Settings)
  let tucked = false;
  let atTop = false;
  let lastTop = 0;
  // background
  let background = 'solid';
  let dotsPulse = true;

  const peekFace = h('span');
  const tabFace = h('span');
  face.mount(peekFace, 'closed');
  face.mount(tabFace, 'open');

  const pill = h('div', { class: 'pill' });
  // Short text a module can show in place of the pill while inactive (a running timer...).
  const status = h('span', { class: 'status' });
  const statuses = new Map(); // owner → text; the oldest still-set owner keeps the slot
  const peek = h('button', { class: 'peek', 'aria-label': 'Open usagi', onclick: () => setMode('open') }, peekFace);
  const tab = h('button', { class: 'tab', 'aria-label': 'Close usagi', onclick: () => setMode(near ? 'welcome' : 'inactive') }, tabFace);
  const content = h('div', { class: 'content' });
  const railLeft = h('div', { class: 'rail rail-left' });
  const railRight = h('div', { class: 'rail rail-right' });
  const island = h('div', { class: 'island' }, svg(EAR_L), svg(EAR_R), pill, status, peek, tab, content, railLeft, railRight);
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
    lastTop = performance.now();
    setTucked(false);
    applySize();
    if (prev === 'open' && document.activeElement && island.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    modeListeners.forEach((fn) => fn(next, prev));
  }

  function setTucked(value) {
    if (tucked === value) return;
    tucked = value;
    island.classList.toggle('tucked', value);
  }

  function updateTuck(now) {
    // Not eligible to hide: keep the face up and restart the idle clock.
    if (mode !== 'open' || faceMode !== 'idle' || facePinned || atTop) {
      lastTop = now;
      setTucked(false);
      return;
    }
    if (now - lastTop > faceDelay) setTucked(true);
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
    const revealH = tucked ? REVEAL_H.tucked : REVEAL_H.shown;
    atTop = mode === 'open' && Math.abs(x - cx) <= ((TAB_W / 2 + REVEAL_PAD_X) * scale) && y >= -8 && y <= revealH * scale;
    if (atTop) { lastTop = performance.now(); setTucked(false); }
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
    // Peek out even though the cursor is away (timer done, notification...).
    attention(ms = 3000) {
      attentionUntil = performance.now() + ms;
      lastTop = performance.now();
      setTucked(false);
      if (mode === 'inactive') setMode('welcome');
    },
    /** 'always' keeps the face up while open; 'idle' slides it away after delayMs. */
    setFaceHide(modeName, delayMs) {
      faceMode = modeName;
      faceDelay = delayMs;
      lastTop = performance.now();
    },
    /** The current module wants the face kept up (e.g. Settings). */
    pinFace(value) {
      facePinned = !!value;
      if (facePinned) setTucked(false);
      lastTop = performance.now();
    },
    /** Open-island background: 'solid' | 'dots' | 'gradient', plus the gradient's bottom color. */
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
    frame(kick, now = performance.now()) {
      pill.style.setProperty('--pulse', (1 + kick * 0.36).toFixed(3));
      if (background === 'dots' && dotsPulse && mode === 'open') {
        island.style.setProperty('--dot-a', (0.4 + kick * 0.35).toFixed(3));
      }
      updateTuck(now);
      settle();
    },
  };
}
