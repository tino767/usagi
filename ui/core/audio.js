// Audio for the face. The backend sends `[kick, vocal]` (0..1 each) from
// system audio (see src-tauri/src/audio.rs): kick drives the bob, vocal is
// exposed to modules as `ctx.audio.vocal`. When that isn't available — preview mode, or capture not permitted —
// a gentle fake beat and fake singing run while media is playing.

const STALE_MS = 600;

export function createAudio(bridge) {
  let kick = 0;
  let vocal = 0;
  let lastAt = -Infinity;
  bridge.onAudio?.((v) => {
    kick = Number(v?.[0]) || 0;
    vocal = Number(v?.[1]) || 0;
    lastAt = performance.now();
  });

  const out = { kick: 0, vocal: 0 };
  return {
    get live() { return performance.now() - lastAt < STALE_MS; },
    read(now, mediaPlaying) {
      if (now - lastAt < STALE_MS) {
        out.kick = kick;
        out.vocal = vocal;
      } else {
        out.kick = mediaPlaying ? fakeBeat(now) : 0;
        out.vocal = mediaPlaying ? fakeVocal(now) : 0;
      }
      return out;
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

// Phrases of ~3 syllables a second, with a breath between lines.
export function fakeVocal(now) {
  const sec = now / 1000;
  if (sec % 4.8 > 3.2) return 0;
  const syllable = Math.max(0, Math.sin(sec * Math.PI * 2 * 3.1));
  return syllable * (0.65 + 0.35 * Math.sin(sec * 1.7));
}
