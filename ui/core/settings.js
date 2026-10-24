// The built-in Settings page. Always last in the rotation; can't be removed.
//
// Home is a row of category tiles at the normal island size. Picking one grows
// the island down into that page (512×448); Back, scrolling away or closing
// shrinks it again. The face stays up here even when auto-hide is on.
//
// To add a setting: give it a default in prefs.js, react to it in app.js,
// and add a row to one of the pages below.

import { h } from './dom.js';
import { icons } from './icons.js';
import { SYSTEM_ID } from './rotation.js';

const PAGE_SIZE = { h: 448 };
const SCALES = [[0.75, '75%'], [1, '100%'], [1.25, '125%']];
const RAILS = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
const BACKGROUNDS = [['solid', 'Solid'], ['dots', 'Dot matrix'], ['gradient', 'Gradient']];
const SWATCHES = [['Violet', '#3a1f6b'], ['Blue', '#13306e'], ['Teal', '#0e4a4a'], ['Rose', '#5c1733'], ['Ember', '#5e2a0b']];const FACE = [['always', 'Always up'], ['idle', 'Hide when idle']];
const DELAYS = [3, 5, 10];
// Gradient colors are capped at this relative luminance so white text on the
// bottom of the island stays above ~7:1.
const MAX_LUMA = 0.08;
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
const IS_WINDOWS = /Win/i.test(navigator.platform || navigator.userAgent);

export function createSettings({ catalog, getRotation, prefs, bridge, island }) {
  return {
    id: SYSTEM_ID,
    name: 'Settings',
    icon: icons.settings,
    keepFace: true,

    create(ctx) {
      let page = null; // null = home | 'modules' | 'appearance' | 'behavior' | 'about'
      let query = '';
      let searching = false;
      let version = '';
      let autostart = null; // unknown until asked
      const root = h('div', { class: 'set' });

      bridge.version?.().then((v) => { version = v || ''; if (!page || page === 'about') render(); }).catch(() => {});

      function go(next) {
        page = next;
        query = '';
        searching = false;
        render();
        ctx.island.resize();
        island.animateContent('swap');
        if (next === 'behavior' && autostart === null) {
          bridge.autostart?.get().then((on) => { autostart = !!on; if (page === 'behavior') render(); }).catch(() => {});
        }
      }

      function render() {
        const view = { modules: modulesPage, appearance: appearancePage, behavior: behaviorPage, about: aboutPage }[page];
        root.replaceChildren(view ? view() : home());
      }

      // ---------- building blocks ----------

      const header = (title, ...extra) => h('div', { class: 'set-head' },
        h('button', { class: 'set-icon-btn', 'aria-label': 'Back to settings', html: icons.back, onclick: () => go(null) }),
        title, ...extra);

      const titleEl = (text) => h('span', { class: 'set-title' }, text);

      function seg(label, options, current, pick, { disabled = false } = {}) {
        return h('div', { class: 'set-seg', role: 'group', 'aria-label': label },
          ...options.map(([value, text]) => h('button', {
            'aria-pressed': String(value === current),
            disabled,
            onclick: () => { pick(value); ctx.face.nod(); render(); },
          }, text)));
      }

      function toggle(label, on, flip, { disabled = false } = {}) {
        return h('button', {
          class: 'set-switch',
          role: 'switch',
          'aria-checked': String(!!on),
          'aria-label': label,
          disabled,
          onclick: () => { flip(!on); ctx.face.nod(); },
        });
      }

      const row = (label, control, { sub, off = false } = {}) =>
        h('div', { class: `set-row${off ? ' is-off' : ''}` },
          h('span', { class: 'set-label' }, label, sub ? h('small', {}, sub) : null),
          control);

      const group = (...rows) => h('div', { class: 'set-group' }, ...rows.filter(Boolean));
      const eyebrow = (text) => h('span', { class: 'set-eyebrow' }, text);

      // ---------- home ----------

      function home() {
        const rotation = getRotation();
        const total = [...catalog.keys()].filter((id) => id !== SYSTEM_ID).length;
        const bg = BACKGROUNDS.find(([v]) => v === prefs.get('background'))?.[1] ?? 'Solid';
        const tiles = [
          ['modules', 'Modules', icons.grid, `${rotation.size()} of ${total} on`],
          ['appearance', 'Appearance', icons.appearance, `${bg} · ${Math.round(prefs.get('scale') * 100)}%`],
          ['behavior', 'Behavior', icons.behavior, prefs.get('face') === 'idle' ? `Hides after ${prefs.get('faceDelay')}s` : 'Face always up'],
          ['about', 'About', icons.info, version ? `v${version}` : 'usagi'],
        ];
        return h('div', { class: 'set-home' }, ...tiles.map(([id, label, icon, sub]) =>
          h('button', { class: 'set-tile', onclick: () => go(id) },
            h('span', { class: 'set-tile-icon', html: icon }),
            h('span', { class: 'set-tile-text' },
              h('span', { class: 'set-tile-label' }, label),
              h('span', { class: 'set-tile-sub' }, sub)))));
      }

      // ---------- modules ----------

      function modulesPage() {
        const rotation = getRotation();
        const defs = [...catalog.values()].filter((d) => d.id !== SYSTEM_ID);
        const grid = h('div', { class: 'set-grid' });
        const meta = h('span', { class: 'set-meta' });

        function fill() {
          const q = query.trim().toLowerCase();
          const shown = q ? defs.filter((d) => `${d.name} ${d.description ?? ''}`.toLowerCase().includes(q)) : defs;
          meta.textContent = `${rotation.size()} of ${defs.length} on`;
          grid.replaceChildren(...(shown.length ? shown.map((def) => {
            const on = rotation.has(def.id);
            return h('button', {
              class: `set-mod${on ? ' on' : ''}`,
              'aria-pressed': String(on),
              title: def.description || def.name,
              onclick: () => {
                if (on) rotation.remove(def.id);
                else { rotation.add(def.id); ctx.face.nod(); }
                fill();
              },
            }, h('span', { class: 'set-mod-icon', html: def.icon || icons.spark }), h('span', {}, def.name));
          }) : [h('p', { class: 'set-empty' }, `No modules match “${query}”`)]));
        }

        let head;
        if (searching) {
          const input = h('input', {
            class: 'set-search', type: 'search', placeholder: `Search ${defs.length} modules`,
            'aria-label': 'Search modules', value: query,
            oninput: () => { query = input.value; fill(); },
            onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); searching = false; query = ''; render(); } },
          });
          head = header(input, h('button', {
            class: 'set-icon-btn', 'aria-label': 'Close search', html: icons.close,
            onclick: () => { searching = false; query = ''; render(); },
          }));
          setTimeout(() => input.focus(), 0);
        } else {
          head = header(titleEl('Modules'), meta, h('button', {
            class: 'set-icon-btn', 'aria-label': 'Search modules', html: icons.search,
            onclick: () => { searching = true; render(); },
          }));
        }
        fill();
        return h('div', { class: 'set-page' }, head, grid);
      }

      // ---------- appearance ----------

      function appearancePage() {
        const bg = prefs.get('background');

        const bgTiles = h('div', { class: 'set-bgs', role: 'radiogroup', 'aria-label': 'Background' },
          ...BACKGROUNDS.map(([value, label]) => h('button', {
            class: 'set-bg', role: 'radio', 'aria-checked': String(bg === value),
            onclick: () => { prefs.set('background', value); ctx.face.nod(); render(); },
          }, h('span', { class: `set-bg-preview ${value}` }), label)));

        // preset swatches plus a custom color; fix() adjusts picked colors
        const colorRow = (label, key, swatches, fix = (c) => c) => {
          const value = prefs.get(key);
          const preset = swatches.some(([, hex]) => hex === value);
          const picker = h('input', {
            type: 'color', class: 'set-color-input', value, tabindex: '-1', 'aria-hidden': 'true',
            oninput: () => prefs.set(key, fix(picker.value)),
            onchange: () => render(),
          });
          return row(label, h('div', { class: 'set-swatches', role: 'radiogroup', 'aria-label': label },
            ...swatches.map(([name, hex]) => h('button', {
              class: 'set-swatch', role: 'radio', 'aria-label': name, 'aria-checked': String(value === hex),
              style: { background: hex },
              onclick: () => { prefs.set(key, hex); ctx.face.nod(); render(); },
            })),
            h('button', {
              class: 'set-swatch custom', role: 'radio', 'aria-label': 'Custom color', 'aria-checked': String(!preset),
              style: preset ? null : { background: value },
              html: preset ? icons.plus : '',
              onclick: () => picker.click(),
            }),
            picker));
        };

        let options = null;
        if (bg === 'dots') {
          options = group(row('Dots pulse with the beat', toggle('Dots pulse with the beat', prefs.get('dotsPulse'), (v) => { prefs.set('dotsPulse', v); render(); })));
        } else if (bg === 'gradient') {
          options = group(colorRow('Gradient color', 'gradient', SWATCHES, capLuma));
        }

        return h('div', { class: 'set-page' }, header(titleEl('Appearance')),
          h('div', { class: 'set-scroll' },
            group(
              row('Size', seg('Size', SCALES, prefs.get('scale'), (v) => prefs.set('scale', v))),
              row('Side rails', seg('Side rails', RAILS, prefs.get('rail'), (v) => prefs.set('rail', v)))),
            h('div', { class: 'set-block' }, eyebrow('Background'), bgTiles),
            options));
      }

      // ---------- behavior ----------

      function behaviorPage() {
        const idle = prefs.get('face') === 'idle';
        return h('div', { class: 'set-page' }, header(titleEl('Behavior')),
          h('div', { class: 'set-scroll' },
            h('div', { class: 'set-block' }, eyebrow('Face'), group(
              row('When open', seg('Face when open', FACE, prefs.get('face'), (v) => prefs.set('face', v))),
              row('Hide after', seg('Hide after', DELAYS.map((d) => [d, `${d}s`]), prefs.get('faceDelay'), (v) => prefs.set('faceDelay', v), { disabled: !idle }),
                { off: !idle, sub: 'Hover the top edge to bring him back' }))),
            h('div', { class: 'set-block' }, eyebrow('System'), group(
              row('Hide over fullscreen apps',
                toggle('Hide over fullscreen apps', prefs.get('hideFullscreen'), (v) => { prefs.set('hideFullscreen', v); render(); }, { disabled: !IS_WINDOWS }),
                { sub: IS_WINDOWS ? 'Games, videos, presentations' : 'Windows only for now', off: !IS_WINDOWS }),
              row('Launch at login',
                toggle('Launch at login', autostart, (v) => {
                  autostart = v;
                  render();
                  bridge.autostart?.set(v).then((on) => { autostart = !!on; render(); }).catch(() => { autostart = !v; render(); });
                }, { disabled: autostart === null })),
            ))));
      }

      // ---------- about ----------

      function aboutPage() {
        const shortcut = IS_MAC ? '⌘ ⌥ U' : 'Ctrl Alt U';
        return h('div', { class: 'set-page' }, header(titleEl('About')),
          h('div', { class: 'set-scroll' },
            group(
              row('Version', h('span', { class: 'set-value' }, version || '—')),
              row('Open or close', h('span', { class: 'set-value' }, shortcut)),
              row('Source', h('span', { class: 'set-value' }, 'github.com/tino767/usagi')))));
      }

      render();
      return {
        el: root,
        size: () => (page ? PAGE_SIZE : null),
        show() { page = null; render(); },
        hide() { page = null; query = ''; searching = false; },
      };
    },
  };
}

// Darken a color until its relative luminance is at most MAX_LUMA.
function capLuma(hex) {
  const n = parseInt(hex.slice(1), 16);
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luma = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  for (let i = 0; i < 40 && luma(rgb) > MAX_LUMA; i++) rgb = rgb.map((c) => Math.floor(c * 0.94));
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
