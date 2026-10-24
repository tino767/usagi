// Side-rail contrast. The rails sit outside the island, on whatever is behind
// the window, so while open this samples the screen in thin strips around each
// rail (the rail itself would just read back its own color) and gives each rail
// black or white on its own.

const FIRST_MS = 300; // let the open transition mostly land before measuring
const POLL_MS = 600;
// White beats black below ≈0.18 relative luminance; the gap keeps it from flickering.
const TO_LIGHT = 0.15;
const TO_DARK = 0.22;
const GAP = 4;
const STRIP = 6;

export function createContrast({ island, bridge }) {
  const rails = [island.railLeft, island.railRight];
  let supported = typeof bridge.backdrop === 'function';
  let timer = 0;
  let override = null; // 'light' | 'dark' from Settings; null = sample the screen

  const pin = (tone) => rails.forEach((rail) => { rail.dataset.rail = tone; });

  // The outer side and the strip below — the inner side hugs the island.
  function strips(rail) {
    const r = rail.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const outerX = rail === island.railLeft ? r.left - GAP - STRIP : r.right + GAP;
    return [
      { x: outerX, y: r.top, w: STRIP, h: r.height },
      { x: r.left, y: r.bottom + GAP, w: r.width, h: STRIP },
    ];
  }

  async function sample() {
    const groups = rails.map(strips);
    const rects = groups.filter(Boolean).flat();
    if (!rects.length) return;
    let luma;
    try {
      luma = await bridge.backdrop(rects);
    } catch {
      supported = false; // no screen access on this platform: fall back to black
      stop();
      pin('dark');
      return;
    }
    let i = 0;
    groups.forEach((group, n) => {
      if (!group) return;
      const l = (luma[i] + luma[i + 1]) / 2;
      i += 2;
      if (l < TO_LIGHT) rails[n].dataset.rail = 'light';
      else if (l > TO_DARK) rails[n].dataset.rail = 'dark';
    });
  }

  function stop() {
    clearTimeout(timer);
    timer = 0;
  }

  function start() {
    stop();
    if (override) { pin(override); return; }
    const tick = async () => {
      await sample();
      if (timer && supported && island.mode === 'open') timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, FIRST_MS);
  }

  island.onMode((next) => {
    if (next === 'open' && (supported || override)) start();
    else stop();
  });

  return {
    /** 'auto' samples the backdrop; 'light' / 'dark' force a tone. */
    setMode(value) {
      override = value === 'light' || value === 'dark' ? value : null;
      if (override) { stop(); pin(override); }
      else if (island.mode === 'open' && supported) start();
      else if (!supported) pin('dark');
    },
  };
}
