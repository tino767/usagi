// Persistent key/value storage. Each module gets its own scope through ctx.store.

export function createStore(prefix) {
  const k = (key) => `${prefix}:${key}`;
  const api = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(k(key));
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(k(key), JSON.stringify(value)); } catch {}
    },
    remove(key) {
      try { localStorage.removeItem(k(key)); } catch {}
    },
    scope(name) { return createStore(`${prefix}:${name}`); },
  };
  return api;
}
