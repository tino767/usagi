# usagi

A desktop companion that lives in the top edge of your screen. He sleeps as a
small pill, peeks out when your cursor comes near, and opens into a panel of
utilities when you click his face. Scroll to move between modules; click his
face again to close.

Built with Tauri 2: a Rust backend for the OS work and plain HTML/CSS/JS for
everything you see. Runs on Windows, macOS and Linux.

## Setup

1. Install Rust: https://rustup.rs
2. Install Node 18+.
3. Platform prerequisites (one time):
   - **Windows**: Visual Studio Build Tools with "Desktop development with C++". WebView2 ships with Windows 11.
   - **macOS**: `xcode-select --install`
   - **Linux (Debian/Ubuntu)**:
     `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev build-essential pulseaudio-utils`
4. `npm install`

```bash
npm run dev       # run the app (first build takes a few minutes)
npm run build     # installer for your OS → src-tauri/target/release/bundle/
npm run preview   # UI only, in a browser at http://localhost:5179, with fake media
```

`Ctrl+Alt+U` (`Cmd+Option+U` on macOS) toggles usagi open. The tray icon has
Launch at login, Hide when a fullscreen app is in front, Reload and Quit.

## How it's put together

```
ui/                        everything you see — no build step
  core/                    the framework; modules never need to touch this
    island.js              inactive / welcome / open + hit-testing
    face.js                the face and reaction blending
    rotation.js            module list, scroll-to-switch, position rail
    manager.js             the built-in Modules page (always last)
    bridge.js              talks to the Rust backend (mock-bridge.js in preview)
    audio.js               kick + vocal levels from the backend, fake fallback
    contrast.js            black or white side rails, depending on what's behind them
    store.js               per-module persistent storage
    dom.js                 tiny DOM helpers (h, svg)
    app.js                 boot
  modules/
    media/  timer/  notes/
    _template/             copy this to start a new module
src-tauri/                 Rust backend
  src/main.rs              commands, tray, plugins
  src/overlay.rs           window placement, click-through, cursor feed, stay-on-top, fullscreen hiding
  src/audio.rs             kick + vocal detection from system audio
  src/system/              media + volume per OS: win.rs, mac.rs, linux.rs
scripts/
  gen-modules.js           writes ui/modules/index.json (runs before dev/build)
  preview.js               browser preview server
```

**Click-through.** The window is transparent and ignores the mouse. The backend
sends the cursor position every 50 ms; when it's over the island or a side rail,
the UI makes the window clickable, then releases it when the cursor leaves.

**Staying on top.** On Windows usagi re-claims the topmost spot every second (other
always-on-top apps can push it down) and hides while a fullscreen app, game or
presentation is in front. On macOS it sits above the menu bar, so on a notched Mac it
lines up with the notch, and it follows you across Spaces and fullscreen apps.

## Adding a module

1. Copy `ui/modules/_template` to `ui/modules/<id>`.
2. Set `id` in `index.js` to the folder name, give it a `name` and `icon`.
3. Restart `npm run dev`, open the **Modules** page and click it to add it.

```js
export default {
  id: 'pomodoro',
  name: 'Pomodoro',
  icon: icons.timer,           // 24×24 SVG string in currentColor
  order: 4,                    // default position on first run
  styles: true,                // load ./style.css
  size: { w: 520, h: 224 },    // optional open size

  create(ctx) {                // once, when it joins the rotation; keeps running in the background
    return { el, rail, show() {}, hide() {}, destroy() {} };
  },
};
```

| `ctx` | |
|---|---|
| `h(tag, props, ...children)` | DOM helper |
| `icons` | shared glyphs |
| `face.flash(ms)` / `bounce(ms)` / `nod(ms)` / `tilt(deg)` | reactions |
| `island.attention(ms)` | peek out even when the cursor is away |
| `island.status(text)` | short text shown in place of the collapsed pill (`null` clears) |
| `island.isFront()` / `open()` / `close()` | visibility and control |
| `system.media` / `system.volume` | OS bridge |
| `audio.kick` / `audio.vocal` | current 0..1 kick and vocal levels |
| `store.get(key, fallback)` / `set(key, value)` | persisted, scoped to the module |

Shared CSS: `.btn-round`, `.btn-ghost`, `.chip`, `.eyebrow`, `.vslider`. Tokens are
at the top of `ui/core/styles.css`.

A module that needs something new from the OS: add a `#[tauri::command]` in
`src-tauri/src/main.rs`, call it from `ui/core/bridge.js`, and pass it through
`ctx.system` in `app.js`.

## Platform support

| | Windows 10/11 | macOS 12+ | Linux (X11) |
|---|---|---|---|
| Now playing + controls | Any app in the media flyout | Spotify, Apple Music | Any MPRIS player |
| Album art | ✓ | Spotify | ✓ |
| System volume | Core Audio | `osascript` | `wpctl` / `pactl` |
| Music reaction | WASAPI loopback | Core Audio tap (14.2+, asks permission) | `parec` on the sink monitor |
| Hide over fullscreen apps | ✓ | not yet | not yet |

Notes:
- **macOS**: Apple locked the system-wide "now playing" API to its own apps in
  macOS 15.4, so usagi talks to Spotify and Music directly. The first time, macOS asks
  to let usagi control each app, and to listen to system audio for the music reaction.
- **Linux**: Wayland doesn't let apps place themselves or stay on top, so usagi
  runs through XWayland automatically. Transparency needs a compositor (any
  modern desktop has one).
- Single display: usagi sits on the primary display.

## Status

Runs on Windows and Linux. macOS is type-checked but hasn't been run on real
hardware yet, so expect small fixes the first time you build there.

## License

Proprietary. Copyright (c) 2026 Valentino Valero. All rights reserved. See
[LICENSE](LICENSE).
