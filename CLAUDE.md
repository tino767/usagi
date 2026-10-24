# usagi

Desktop companion that lives in the top-center edge of the screen, merging into
the border like a dynamic island. A platform for small utilities ("modules")
with a reactive tamagotchi-style face. Tauri 2 (Rust backend) + plain
HTML/CSS/JS UI, no framework, no bundler. Targets Windows, macOS, Linux.

## Design source of truth

Canvas: https://claude.ai/artifact/Hpjy8b4AMyBU6XaUe8V3i7
- `Main.dc.html`: interactive prototype (states, modules, reactions)
- `Modules.dc.html`: each module's open state
- `Expressions.dc.html`: face states and their triggers
- `SettingsC.dc.html`: the Settings design that was built (A and B are the rejected alternatives)
- `Compact.dc.html`: face auto-hide prototype

When asked to sync with the design, read the canvas with the Artifact tool and
port visual changes into `ui/`. When the UI changes in code, offer to update the
canvas to match. Visuals are owned by the canvas; behavior is owned by the code.

## Commands

- `npm run dev`: run the app (Tauri)
- `npm run preview`: UI only at http://localhost:5179 with a mock OS bridge. Use this to check UI work in a browser.
- `npm run build`: installers
- `cd src-tauri && cargo check`: backend type-check

## Layout

- `ui/core/`: framework (island state machine, face, rotation, settings, prefs, bridge). Modules never import from here except `icons.js`.
- `ui/core/prefs.js`: every user preference and its default. `settings.js` writes them; `app.js` applies them to the core.
- `ui/modules/<id>/`: one folder per module; `_template` is the starting point. Folders starting with `_` are ignored.
- `src-tauri/src/overlay.rs`: window placement, click-through, cursor feed, stay-on-top, fullscreen hiding
- `src-tauri/src/system/{win,mac,linux}.rs`: media + volume per OS, same function signatures
- `src-tauri/src/audio.rs`: system-audio kick + vocal levels, sent to the UI as the `audio` event (`[kick, vocal]`)

## Design rules

- States: inactive (76×30 pill, r15, white bar 46×7; a module's `ctx.island.status(text)` replaces the white bar; `ctx.island.progress(0..1)`, e.g. the running timer, turns it into a progress bar: a 25% white track with the white bar filling it left to right, and no audio pulse), welcome (168×48, r24, eyes closed "= ㅅ =", same footprint and face size as the open tab), open (512×224, r80, white face tab 168×48 r24, eyes open "• ㅅ •"). Concave top fillets ("ears"): 22px (26px open), capped at h − r so they meet the bottom corner flush.
- Click the face to open; click it again to close. Scroll switches modules. The Settings page is always last.
- Face auto-hide (pref `face: 'idle'`, default): while open and idle for `faceDelay` seconds (default 5), the face tab slides up off screen and the island loses 40px (224 → 184); content and rails move up with it. The cursor reaching the top strip brings him back; so does `ctx.island.attention()`. Modules with `keepFace: true` (Settings) never hide him. `face: 'always'` turns it off.
- Settings: home is four category tiles (Modules, Appearance, Behavior, About) at the normal size; a category grows the island just enough to fit its content, up to 512×460 (past that it scrolls), and is the only page allowed to grow. Modules is a 4-across tile grid (white = in rotation) with search. Row pages end in a full-width "bumper" tile, spaced like a section, that fills the island's bottom curve so no real row is clipped by it; it resets that page's prefs to their defaults (About resets all), disabled when nothing differs, and needs a second click within 3s to confirm. Back, scrolling away or closing returns to home.
- Open-island backgrounds (pref `background`): solid, dot matrix (38px pitch, centered horizontally, fading in from black at the top, optional pulse on the kick), gradient (black for the top 30%, then the user's color; custom colors are capped at luminance 0.08 so white text stays readable), glass (the screen behind the island, streamed small by the backend (`glass_start`, Desktop Duplication on Windows) whenever it changes and blurred in CSS by `ui/core/glass.js`, under a veil that is solid black for the top 20% so the edge and ears still merge with the screen and eases to lighter frosted glass at the bottom; the veil darkens over bright backdrops to keep white text readable. usagi is hidden from screen capture while it's open with glass, or the copy would be the island itself. Windows only; elsewhere, and with pref `glassPerformance`, it is a plain see-through smoked veil with no blur or capture). Welcome and inactive stay solid black.
- Side rails sit outside the island: left = module's rail (volume for media), right = module icon + position dots.
- Palette: island #000, paper #fff, surface #141414 / #1c1c1c, muted text #a6a6a6, tongue #E0606A. Font: Poppins 400/500/600 (bundled in `ui/fonts`).
- Content area inside the open island: 468×140 (left/right 22, top 62, bottom 22); up to 468×376 on a Settings page. Side and bottom insets must stay equal so `--r-fit` (80 − 22 = 58) runs concentric with the island's corners.
- The overlay window is 760×580 so a Settings page fits at 125% scale; the extra area is click-through.
- Rails: 20px icon, 8px-wide capsule slider/dots (active dot 24px tall), 17px from the island's sides, top 74.
- Face reactions are requested by modules (`ctx.face.bounce/nod/tilt/sing`) and blended by the core. Modules never draw the face.
- Audio drives the face: the kick bobs the head. The mouth (tongue) opens only on `ctx.face.sing`, used by the timer's alarm; system-audio vocals don't move it.

## Rules for changes

- New UI capability → a module, not a core change, unless every module needs it.
- New setting → default in `prefs.js`, applied in `app.js` with `prefs.watch`, a row on the right page in `settings.js`, and its key in that page's reset list.
- A module that changes size while showing returns it from `size()` on its instance and calls `ctx.island.resize()`.
- New OS capability → a `#[tauri::command]` in `main.rs`, implemented in each of `win.rs`, `mac.rs`, `linux.rs` (return an error where unsupported), wired through `ui/core/bridge.js`, and exposed via `ctx.system`.
- Keep all three platforms compiling. Gate platform code with `#[cfg(...)]`.
- Click-through depends on `island.js` hit-testing: anything clickable must sit inside the island or a rail.
