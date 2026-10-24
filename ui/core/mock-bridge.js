// Stand-in for window.usagi when the renderer runs in a plain browser
// (npm run preview). Lets you design modules without launching the app.

export function createMockBridge() {
  const mediaListeners = new Set();
  // next/prev cycle these; the long one exercises the scrolling title
  const tracks = [['snowfall', 'The Seventh Column'], ['Everything Happens Twice When You Are Not Looking', 'Low Tide Choir']];
  let track = 0;
  let media = { available: true, title: tracks[0][0], artist: tracks[0][1], album: '', app: 'preview', playing: true, thumbnail: null };
  let volume = 0.62;
  let autostart = false;
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
    setHideFullscreen: () => {},
    autostart: {
      get: async () => autostart,
      set: async (on) => { autostart = !!on; return autostart; },
    },
    version: async () => 'preview',
    media: {
      get: async () => ({ ...media }),
      command: async (cmd) => {
        if (cmd === 'toggle') media = { ...media, playing: !media.playing };
        if (cmd === 'next' || cmd === 'prev') {
          track = (track + (cmd === 'next' ? 1 : tracks.length - 1)) % tracks.length;
          media = { ...media, title: tracks[track][0], artist: tracks[track][1] };
        }
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
