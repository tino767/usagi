// Bass for the face. The backend sends a 0..1 `bass` level from system audio
// (see src-tauri/src/audio.rs). When that isn't available — preview mode, or
// capture not permitted — a gentle fake beat runs while media is playing.

const STALE_MS = 600;

export function createBass(bridge) {
  let native = 0;
  let lastAt = -Infinity;
  bridge.onBass?.((v) => {
    native = Number(v) || 0;
    lastAt = performance.now();
  });

  return {
    get live() { return performance.now() - lastAt < STALE_MS; },
    read(now, mediaPlaying) {
      if (now - lastAt < STALE_MS) return native;
      return mediaPlaying ? fakeBeat(now) : 0;
    },
  };
}

// 118 BPM pulse with a heavier downbeat.
export function fakeBeat(now) {
  const beat = 60 / 118;
  const sec = now / 1000;
  const phase = (sec % beat) / beat;
  const downbeat = Math.floor(sec / beat) % 4 === 0;
  return Math.exp(-phase * 7) * (downbeat ? 1 : 0.7) * 0.85;
}
