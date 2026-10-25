// User preferences: one place to read them, change them and react to changes.
// Persisted through the store; the Settings page writes, the core listens.

export const DEFAULTS = {
  scale: 1,                // UI scale: 0.75 | 1 | 1.25
  rail: 'auto',            // side rails: 'auto' | 'light' | 'dark'
  background: 'solid',     // open island: 'solid' | 'dots' | 'gradient' | 'glass'
  gradient: '#3a1f6b',     // bottom color of the gradient background
  dotsPulse: true,         // dot matrix brightens on the kick
  glassPerformance: false, // glass without the blur or screen capture, just see-through
  face: 'always',          // 'always' (face stays up) | 'idle' (slides away when idle)
  faceDelay: 5,            // seconds before the face slides away
  hideFullscreen: true,    // hide over fullscreen apps (Windows)
};

export function createPrefs(store) {
  const listeners = new Map();
  const get = (key) => store.get(key, DEFAULTS[key]);

  return {
    get,
    set(key, value) {
      if (get(key) === value) return;
      store.set(key, value);
      listeners.get(key)?.forEach((fn) => fn(value));
      listeners.get('*')?.forEach((fn) => fn(key, value));
    },
    /** Calls fn now with the current value, then on every change. */
    watch(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      if (key !== '*') fn(get(key));
      return () => listeners.get(key).delete(fn);
    },
  };
}
