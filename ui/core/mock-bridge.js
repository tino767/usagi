// Stand-in for window.usagi when the renderer runs in a plain browser
// (npm run preview). Lets you design modules without launching the app.

export function createMockBridge() {
  const mediaListeners = new Set();
  let media = { available: true, title: 'snowfall', artist: 'The Seventh Column', album: '', app: 'preview', playing: true, thumbnail: null };
  let volume = 0.62;
  const emit = () => mediaListeners.forEach((fn) => fn({ ...media }));

  return {
    platform: 'browser',
    setInteractive: () => {},
    onCursor(fn) {
      const handler = (e) => fn({ x: e.clientX, y: e.clientY });
      window.addEventListener('mousemove', handler);
      document.addEventListener('mouseleave', () => fn({ x: -9999, y: -9999 }));
      return () => window.removeEventListener('mousemove', handler);
    },
    onToggle: () => () => {},
    onAudio: () => () => {},
    media: {
      get: async () => ({ ...media }),
      command: async (cmd) => {
        if (cmd === 'toggle') media = { ...media, playing: !media.playing };
        emit();
        return true;
      },
      onChange(fn) { mediaListeners.add(fn); return () => mediaListeners.delete(fn); },
    },
    volume: {
      get: async () => volume,
      set: async (v) => { volume = v; return true; },
    },
  };
}
