// usagi — renderer boot. Wires the face, the island, the module rotation,
// and the per-frame loop together.

import { h, svg } from './dom.js';
import { icons } from './icons.js';
import { createFace } from './face.js';
import { createIsland } from './island.js';
import { createGlass } from './glass.js';
import { createRotation, SYSTEM_ID } from './rotation.js';
import { createSettings } from './settings.js';
import { createPrefs } from './prefs.js';
import { createStore } from './store.js';
import { createAudio } from './audio.js';
import { createBridge } from './bridge.js';

const bridge = createBridge();
const store = createStore('usagi');
const face = createFace();
const island = createIsland({ root: document.getElementById('stage'), face, bridge });
const glass = createGlass({ island, bridge });
const prefs = createPrefs(store);

// ---- preferences → the core (changed on the Settings page) ----
prefs.watch('scale', (v) => island.setScale(v));
const applyBackground = () => {
  island.setBackground(prefs.get('background'), prefs.get('gradient'), prefs.get('dotsPulse'));
  glass.setOn(prefs.get('background') === 'glass' && !prefs.get('glassPerformance'));
};
['background', 'gradient', 'dotsPulse', 'glassPerformance'].forEach((key) => prefs.watch(key, applyBackground));
prefs.watch('shadow', (v) => island.setShadow(v));
const applyFace = () => island.setFaceHide(prefs.get('face'), prefs.get('faceDelay') * 1000);
['face', 'faceDelay'].forEach((key) => prefs.watch(key, applyFace));
prefs.watch('hideFullscreen', (v) => bridge.setHideFullscreen?.(v));

// ---- load modules from src/renderer/modules/<id>/index.js ----
const found = [];
const ids = (await bridge.listModules?.()) ?? ['media', 'timer', 'notes'];
for (const id of ids) {
  try {
    const def = (await import(`../modules/${id}/index.js`)).default;
    if (!def || def.id !== id || typeof def.create !== 'function') {
      console.warn(`[usagi] modules/${id}/index.js must default-export { id: '${id}', name, icon, create(ctx) }`);
      continue;
    }
    if (def.styles) document.head.append(h('link', { rel: 'stylesheet', href: `modules/${id}/style.css` }));
    found.push(def);
  } catch (err) {
    console.error(`[usagi] couldn't load module "${id}"`, err);
  }
}
// `order` sets the default position on first run; the user's list is saved after that.
found.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
const catalog = new Map(found.map((def) => [def.id, def]));

// ---- shared media state (drives the fallback beat) ----
let mediaPlaying = false;
bridge.media?.onChange((m) => { mediaPlaying = !!m?.playing; });
bridge.media?.get().then((m) => { mediaPlaying = !!m?.playing; }).catch(() => {});

// ---- the context every module receives ----
function makeCtx(id) {
  return {
    id,
    h,
    svg,
    icons,
    face: face.reactions(id),
    island: {
      get mode() { return island.mode; },
      isFront: () => island.mode === 'open' && rotation.current() === id,
      attention: (ms) => island.attention(ms),
      status: (text) => island.setStatus(id, text),
      progress: (value) => island.setProgress(id, value),
      open: () => { rotation.goTo(id); island.setMode('open'); },
      resize: () => { if (rotation.current() === id) rotation.refreshSize(); },
      close: () => island.setMode('inactive'),
    },
    system: { media: bridge.media, volume: bridge.volume },
    audio: { get kick() { return face.kick; }, get vocal() { return face.vocal; } },
    store: store.scope(id),
  };
}

let rotation;
catalog.set(SYSTEM_ID, createSettings({ catalog, getRotation: () => rotation, prefs, bridge, island }));
rotation = createRotation({ island, store, catalog, makeCtx });
rotation.start();

bridge.onToggle?.(() => island.toggle());

// ---- frame loop ----
const audio = createAudio(bridge);

function frame(now) {
  const { kick, vocal } = audio.read(now, mediaPlaying);
  face.setAudio(kick, vocal);
  // While a module has usagi out in full, his face is its alone.
  face.focus(island.summoned ? rotation.current() : null);
  face.frame(now);
  island.frame(kick, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
