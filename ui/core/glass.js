// Glass background. The webview can't see the desktop, so backdrop-filter has
// nothing to blur: instead the backend streams a small copy of the screen
// behind the open island whenever it changes, this draws it on a canvas and
// CSS blurs it. While it runs usagi is hidden from screen capture, or the copy
// would be the island itself. Where the OS can't do either, the glass stays a
// plain smoked veil.

const DOWN = 3; // copy at 1/3 size; the blur hides the difference
// Veil darkness at the bottom: lighter glass over a dark backdrop, darker over
// a bright one so white text stays readable.
const VEIL_MIN = 0.22;
const VEIL_MAX = 0.62;

export function createGlass({ island, bridge }) {
  const canvas = island.frost;
  const frost = canvas.parentNode;
  const g = canvas.getContext('2d', { alpha: false });
  let supported = typeof bridge.glass?.start === 'function';
  let on = false;
  let streaming = false;
  let raf = 0;
  let sent = '';

  const live = (value) => frost.classList.toggle('live', value);

  function fail(err) {
    console.warn('[usagi] glass background unavailable, using plain smoke:', err);
    supported = false;
    stop();
    frost.style.removeProperty('--veil');
  }

  // What to copy: the canvas's box on screen, and the size to shrink it to.
  function target() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    return [rect, Math.max(1, Math.round(rect.w / DOWN)), Math.max(1, Math.round(rect.h / DOWN))];
  }

  function paint(buffer) {
    if (!streaming) return;
    const head = new DataView(buffer, 0, 4);
    const w = head.getUint16(0, true);
    const h = head.getUint16(2, true);
    const bytes = new Uint8Array(buffer, 4);
    if (bytes.length !== w * h * 4) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const img = g.createImageData(w, h);
    const px = img.data;
    let light = 0;
    for (let i = 0; i < bytes.length; i += 4) { // BGRA → RGBA
      px[i] = bytes[i + 2];
      px[i + 1] = bytes[i + 1];
      px[i + 2] = bytes[i];
      px[i + 3] = 255;
      light += 0.2126 * bytes[i + 2] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i];
    }
    g.putImageData(img, 0, 0);
    frost.style.setProperty('--veil', (VEIL_MIN + (VEIL_MAX - VEIL_MIN) * light / (w * h * 255)).toFixed(3));
    live(true);
  }

  // Follow the island as it opens and resizes.
  function track() {
    raf = requestAnimationFrame(track);
    const t = target();
    const key = t && JSON.stringify(t);
    if (!t || key === sent) return;
    sent = key;
    bridge.glass.move(...t).catch(fail);
  }

  async function start() {
    const t = target();
    if (!t) return;
    streaming = true;
    sent = JSON.stringify(t);
    try {
      await bridge.glass.start(...t, paint);
    } catch (err) {
      fail(err);
      return;
    }
    // closed again before the backend answered: make sure it stops too
    if (streaming) track();
    else bridge.glass.stop().catch(() => {});
  }

  function stop() {
    cancelAnimationFrame(raf);
    live(false);
    if (!streaming) return;
    streaming = false;
    bridge.glass.stop().catch(() => {});
  }

  function sync() {
    const want = supported && on && island.mode === 'open';
    if (want && !streaming) start();
    else if (!want && streaming) stop();
  }

  island.onMode(() => sync());

  return {
    /** Glass picked as the background (Settings › Appearance). */
    setOn(value) {
      on = !!value;
      // back to the static veil (performance mode, another background)
      if (!on) frost.style.removeProperty('--veil');
      sync();
    },
  };
}
