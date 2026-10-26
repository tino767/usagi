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
// He can also be pulled down by his face, as far as you like, against more and
// more tension, stretching the island with him once he reaches its bottom. From
// there on his eyes close to "= ㅅ =", and letting go fires onPull (rotation.js
// uses it for the secret Ask usagi page); either way he and the island snap
// back like a rubber band. While summoned he can be pushed back up the same way,
// 1:1, eyes open (no tension): once the content has faded out, letting go
// fires onPush (rotation.js leaves the page, so he tucks away).
// With face auto-hide on (setFaceHide), the tab also slides up off screen while
// the island sits open and idle, and the island gets TUCK px shorter.

import { h, svg } from './dom.js';

const SIZES = {
  inactive: { w: 76, h: 30, r: 15 },
  // Same footprint as the open state's face tab, so opening swaps one for the other in place.
  welcome: { w: 168, h: 48, r: 24 },
  // Every module shares this size; only Settings sets its own height (rotation.js).
  // r: keep --r-fit in styles.css at r − 22, and recheck the timer / media corner notes.
  open: { w: 512, h: 188, r: 64, ear: 26 },
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
// Face auto-hide ("tuck"): while open and idle, the face tab and the rails
// beside it slide up off screen and the island loses this much height.
// Hovering the top strip across the island brings them back.
const TUCK = 48;
// Reveal zone: the open island's width, so the rails come back too.
const REVEAL_W = SIZES.open.w;
const REVEAL_H = { shown: 56, tucked: 24 };

// Each ear reaches one unit under the island so no hairline seam shows at fractional pixels.
const EAR_L = '<svg class="ear ear-l" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 0H17V16H16A16 16 0 0 0 0 0Z"/></svg>';
const EAR_R = '<svg class="ear ear-r" viewBox="0 0 16 16" aria-hidden="true"><path d="M16 0H-1V16H0A16 16 0 0 1 16 0Z"/></svg>';
// usagi's ears, standing on top of his head (the head's top is y 200; the extra
// unit tucks under it). 1000 long, far more than the window is tall: however far
// he's pulled down, the tips stay past the screen edge, so they seem to go on
// forever and keep stretching as he comes down. Earrings low on the right ear,
// where they show while he's summoned.
const BUNNY_EARS = `<svg class="bunny-ears" viewBox="0 -800 168 1001" aria-hidden="true">
  <path fill="var(--paper)" d="M0 -775.5A24.5 24.5 0 0 1 24.5 -800H33.8A24.5 24.5 0 0 1 58.3 -775.5V201H0Z"/>
  <path fill="var(--paper)" d="M109.7 -775.5A24.5 24.5 0 0 1 134.2 -800H143.5A24.5 24.5 0 0 1 168 -775.5V201H109.7Z"/>
  <path fill="var(--tongue)" d="M16.3 200V-770.35A12.85 12.85 0 0 1 42 -770.35V200Z"/>
  <path fill="var(--tongue)" d="M126 200V-770.35A12.85 12.85 0 0 1 151.7 -770.35V200Z"/>
  <circle fill="var(--earring)" cx="168" cy="164.7" r="5"/>
  <circle fill="var(--earring)" cx="168" cy="181.5" r="5"/>
</svg>`;
// Delay before he steps out when the island opens, so it has grown around him first.
const SUMMON_DELAY = 160;
// Pulling him down by his face. The first px follow the cursor 1:1, then each
// gives less (PULL_K sets how soon), but it never stops giving.
const PULL_K = 240;
const PULL_SLOP = 4; // cursor travel before a press is a drag, not a click
const PULL_FADE = 72; // the module's content is gone once he's this far down
const TAB_H = 48;
const INSET = 22; // the content inset: the island grows once his chin is this close to its bottom
const SUMMONED_Y = 118; // keep in sync with .summoned .tab in styles.css
// The snap back: a damped spring (rad/s, damping ratio), so he overshoots and
// wobbles, more the further he was pulled.
const SPRING_W = 18;
const SPRING_Z = 0.32;
const at = (y) => `translateX(-50%) translateY(${y.toFixed(1)}px)`;

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
  let summon = null; // { label, click } from the showing module
  let summonTimer = 0;
  // pulling him down
  let pull = null; // { id, startY, from, rest, y, dragged, armed } while he's held by his face
  let spring = 0; // the snap-back's animation frame
  let swallowClick = false;
  const pullListeners = new Set();
  const pushListeners = new Set();

  const peekFace = h('span');
  const tabFace = h('span');
  const tabSquint = h('span', { class: 'squint' }); // "= ㅅ =" while a pull is armed
  face.mount(peekFace, 'closed');
  face.mount(tabFace, 'open');
  face.mount(tabSquint, 'closed');

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
  const body = h('span', { class: 'bunny' }, svg(BUNNY_EARS), tabFace, tabSquint);
  const tab = h('button', {
    class: 'tab',
    'aria-label': 'Close usagi',
    onclick: () => {
      if (swallowClick) return; // the end of a pull, not a click
      if (summon && mode === 'open') summon.click();
      else setMode(near ? 'welcome' : 'inactive');
    },
  }, body);
  // he blinks when the cursor finds him, so the face reads as the thing to click
  const own = face.reactions('island');
  tab.addEventListener('pointerenter', () => own.blink());
  tab.addEventListener('pointerdown', grab);
  tab.addEventListener('pointermove', drag);
  tab.addEventListener('pointerup', (e) => letGo(e, true));
  tab.addEventListener('lostpointercapture', (e) => letGo(e, false));
  const content = h('div', { class: 'content' });
  const railLeft = h('div', { class: 'rail rail-left' });
  const railRight = h('div', { class: 'rail rail-right' });
  const island = h('div', { class: 'island' }, svg(EAR_L), svg(EAR_R), h('div', { class: 'frost' }, frost), pill, status, peek, tab, content, railLeft, railRight);
  const el = h('div', { class: 'usagi', 'data-mode': mode }, island);
  root.append(el);

  // --dpr lets CSS snap small shapes to whole screen pixels (the rail dots);
  // it changes when the window moves to a monitor with another OS scale
  (function watchDpr() {
    el.style.setProperty('--dpr', String(devicePixelRatio));
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', watchDpr, { once: true });
  })();

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

  // ---- pulling him down by his face ----
  // He slides down inside the island first, and once his chin reaches its
  // bottom inset the island stretches with him (--stretch: extra height under
  // its bottom). The module's content stays put and fades out as he leaves his
  // rest spot, and it all springs back together. While held (.pulling) the tab's CSS transition is off and
  // it's set here every frame, so class changes underneath (summoned) don't
  // start a transition that would fight it.
  const tabY = () => new DOMMatrix(getComputedStyle(tab).transform).f;

  // y: where he is; rest: where he'd sit (0, or SUMMONED_Y), for the fade;
  // up: the content fades as he rises above rest instead of as he drops below it
  function place(y, rest, up = false) {
    const base = parseFloat(island.style.getPropertyValue('--h')) || SIZES.open.h;
    const stretch = Math.max(0, y + TAB_H + INSET - base);
    const fade = Math.max(0, up ? rest - y : y - rest) / PULL_FADE;
    tab.style.transform = at(y);
    island.style.setProperty('--stretch', `${stretch.toFixed(1)}px`);
    content.style.opacity = fade ? Math.max(0, 1 - fade).toFixed(3) : '';
    return stretch;
  }

  function grab(e) {
    if (e.button !== 0 || mode !== 'open' || tucked) return;
    const from = tabY(); // mid-wobble included
    const rest = island.classList.contains('summoned') ? SUMMONED_Y : 0;
    if (spring) {
      cancelAnimationFrame(spring);
      spring = 0;
      place(from, rest);
    }
    pull = { id: e.pointerId, startY: e.clientY, from, rest, y: from, dragged: false };
    tab.setPointerCapture(e.pointerId);
  }

  function drag(e) {
    if (!pull || e.pointerId !== pull.id) return;
    const dy = (e.clientY - pull.startY) / scale;
    if (!pull.dragged) {
      if (Math.abs(dy) < PULL_SLOP) return;
      pull.dragged = true;
      island.classList.add('pulling');
    }
    // no further than the island's bottom staying inside the window
    const maxY = Math.max(pull.from, window.innerHeight / scale - 8 - TAB_H - INSET);
    // summoned, he can also go back up, 1:1, as far as the screen edge
    const y = dy >= 0 ? pull.from + PULL_K * Math.log1p(dy / PULL_K)
      : pull.rest ? Math.max(0, pull.from + dy) : pull.from;
    pull.y = Math.min(y, maxY);
    // armed (letting go now counts) once the island has to grow to hold him,
    // or, going up, once the content has faded out. Only the pull squints his
    // eyes: going up is no strain, so the fade is all that shows it.
    const up = pull.y < pull.rest;
    pull.armed = up
      ? (place(pull.y, pull.rest, true), pull.y <= pull.rest - PULL_FADE)
      : place(pull.y, pull.rest) > 0;
    island.classList.toggle('pull-armed', pull.armed && !up);
  }

  function letGo(e, released) {
    if (!pull || e.pointerId !== pull.id) return;
    const { y, rest, dragged, armed } = pull;
    island.classList.remove('pull-armed');
    pull = null;
    if (!island.classList.contains('pulling')) return; // a plain click
    if (dragged) {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; });
    }
    if (released && armed) (y < rest ? pushListeners : pullListeners).forEach((fn) => fn());
    tab.style.removeProperty('transform');
    snap(y, tabY());
  }

  // A damped spring from y to `to` (g runs 1 → 0, overshooting); the island
  // follows his chin and the content fades back in as he settles.
  function snap(y, to) {
    const up = y < to; // coming back down from a push that didn't go far enough
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const decay = SPRING_Z * SPRING_W;
    const wd = SPRING_W * Math.sqrt(1 - SPRING_Z * SPRING_Z);
    const start = performance.now();
    const step = (now) => {
      const t = (now - start) / 1000;
      const env = Math.exp(-decay * t);
      if (reduced || Math.abs(y - to) * env < 0.5) {
        spring = 0;
        place(to, to);
        tab.style.removeProperty('transform');
        island.classList.remove('pulling');
        return;
      }
      const g = env * (Math.cos(wd * t) + (decay / wd) * Math.sin(wd * t));
      place(to + (y - to) * g, to, up);
      spring = requestAnimationFrame(step);
    };
    step(start);
  }

  function setMode(next) {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    el.dataset.mode = next;
    lastTop = performance.now();
    setTucked(false);
    applySize();
    applySummon(next === 'open' ? SUMMON_DELAY : 0);
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
    if (mode !== 'open' || faceMode !== 'idle' || facePinned || summon || pull || atTop) {
      lastTop = now;
      setTucked(false);
      return;
    }
    // The idle clock starts once the cursor leaves the island;
    // hovering it doesn't bring a hidden face back, only the top strip does.
    if (interactive) lastTop = now;
    else if (now - lastTop > faceDelay) setTucked(true);
  }

  function hitTest(x, y) {
    if (mode === 'inactive') return false;
    const r = island.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return x >= r.left - HIT_PAD && x <= r.right + HIT_PAD && y >= r.top - HIT_PAD && y <= r.bottom + HIT_PAD;
  }

  // Cursor position comes from the main process (window-relative), so this
  // keeps working while the window is click-through.
  function onCursor({ x, y }) {
    const zone = ZONES[mode];
    const cx = window.innerWidth / 2;
    near = Math.abs(x - cx) <= (zone.w * scale) / 2 && y >= -8 && y <= zone.h * scale;
    if (mode === 'inactive' && near) setMode('welcome');
    const revealH = tucked ? REVEAL_H.tucked : REVEAL_H.shown;
    atTop = mode === 'open' && Math.abs(x - cx) <= (REVEAL_W / 2) * scale && y >= -8 && y <= revealH * scale;
    if (atTop) { lastTop = performance.now(); setTucked(false); }
    settle();
    // held by his face: keep the window taking the cursor wherever it goes
    const hit = !!pull || hitTest(x, y);
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
    /** Whether usagi is out in full (open, on a summoning module). */
    get summoned() { return mode === 'open' && !!summon; },
    setMode,
    toggle() { setMode(mode === 'open' ? 'inactive' : 'open'); },
    onMode(fn) { modeListeners.add(fn); return () => modeListeners.delete(fn); },
    onWheel(fn) { island.addEventListener('wheel', fn, { passive: true }); },
    /** He was pulled down by his face and let go (fires before he snaps back). */
    onPull(fn) { pullListeners.add(fn); return () => pullListeners.delete(fn); },
    /** He was summoned, pushed back up by his face and let go (fires before he snaps back). */
    onPush(fn) { pushListeners.add(fn); return () => pushListeners.delete(fn); },
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
    /** Open-island background: 'solid' | 'dots' | 'gradient' | 'glass', plus the gradient's bottom color. */
    setBackground(kind, color, pulse) {
      background = kind;
      dotsPulse = !!pulse;
      island.dataset.bg = kind;
      if (color) island.style.setProperty('--grad', color);
      if (kind !== 'dots' || !dotsPulse) island.style.removeProperty('--dot-a');
    },
    /** A drop shadow under the island and its ears, in every mode. */
    setShadow(on) { el.classList.toggle('has-shadow', !!on); },
    animateContent(kind) {
      content.classList.remove('enter', 'enter-late', 'enter-next', 'enter-prev', 'bump-next', 'bump-prev');
      void content.offsetWidth; // restart the CSS animation
      content.classList.add({
        open: 'enter-late', next: 'enter-next', prev: 'enter-prev', 'bump-next': 'bump-next', 'bump-prev': 'bump-prev',
      }[kind] ?? 'enter');
    },
    frame(kick, now = performance.now()) {
      pill.style.setProperty('--pulse', (1 - kick * 0.36).toFixed(3));
      if (background === 'dots' && dotsPulse && mode === 'open') {
        island.style.setProperty('--dot-a', (0.4 + kick * 0.35).toFixed(3));
      }
      updateTuck(now);
      settle();
    },
  };
}
