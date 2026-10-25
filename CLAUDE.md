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
- `Compact.dc.html`: face auto-hide prototype (built with the 224 tall island; the app now runs it at 188 → 140)

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

- States: inactive (76×30 pill, r15, white bar 46×7; a module's `ctx.island.status(text)` replaces the white bar; `ctx.island.progress(0..1)`, e.g. the running timer, turns it into a progress bar: a 25% white track with the white bar filling it left to right, and no audio pulse), welcome (168×48, r24, eyes closed "= ㅅ =", same footprint and face size as the open tab), open (512×188 for every module, r64, white face tab 168×48 r24, eyes open "• ㅅ •"; Settings home included; only Settings' category pages grow taller). Concave top fillets ("ears"): 22px (26px open), capped at h − r so they meet the bottom corner flush.
- Click the face to open; click it again to close. Scroll switches modules. The Settings page is always last.
- Face auto-hide (pref `face: 'idle'`; default `'always'`, off): while open, `faceDelay` seconds (default 5) after the cursor leaves the island, the face tab and the rails beside it slide up off screen and the island loses 48px (188 → 140), leaving only the module's content, which moves up with it (top 70 → 22). The cursor reaching the strip across the top of the island (512 wide, 56 tall, 24 while hidden) brings them back; so does `ctx.island.attention()`. Never while he's summoned, or on modules with `keepFace: true` (Settings).
- Settings: home is four category tiles (Modules, Appearance, Behavior, About) at the modules' 512×188; a category grows the island just enough to fit its content, up to 512×460 (past that it scrolls), and is the only page allowed to grow. Modules is a 4-across tile grid (white = in rotation) with search. Row pages end in a full-width "bumper" tile, spaced like a section, that fills the island's bottom curve so no real row is clipped by it; it resets that page's prefs to their defaults (About resets all), disabled when nothing differs, and needs a second click within 3s to confirm. Back, scrolling away or closing returns to home.
- Open-island backgrounds (pref `background`): solid, dot matrix (38px pitch, centered horizontally, fading in from black at the top, optional pulse on the kick), gradient (black for the top 30%, then the user's color; custom colors are capped at luminance 0.08 so white text stays readable), glass (the screen behind the island, streamed small by the backend (`glass_start`, Desktop Duplication on Windows) whenever it changes and blurred in CSS by `ui/core/glass.js`, under a veil that is solid black for the top 20% so the edge and ears still merge with the screen and eases to lighter frosted glass at the bottom; the veil darkens over bright backdrops to keep white text readable. usagi is hidden from screen capture while it's open with glass, or the copy would be the island itself. Windows only; elsewhere, and with pref `glassPerformance`, it is a plain see-through smoked veil with no blur or capture). Welcome and inactive stay solid black.
- Rails sit in the open island's shoulders, either side of the face tab: left = module's rail (volume for media), right = module icon + position dots.
- Palette: island #000, paper #fff, surface #141414 / #1c1c1c, muted text #a6a6a6, tongue #E0606A. Font: Poppins 400/500/600 (bundled in `ui/fonts`).
- Content area inside the open island: 468×96 (left/right 22, top 70 (22 under the face tab), bottom 22), the same for every module and Settings home; up to 468×376 on a Settings category page. Modules lay out as one primary row (at most a slim second row, like the timer's presets) and skip labels the rail icon already gives. Side and bottom insets must stay equal so `--r-fit` (64 − 22 = 42) runs concentric with the island's corners.
- The overlay window is 760×580 so a Settings page fits at 125% scale; the extra area is click-through.
- Rails: the original vertical rails turned horizontal, each row centered in its shoulder (island side to face tab, 172 wide) and on the tab (24 tall, top 12): 20px icon, 5px gap, then 8px capsule dots (active one 24px wide) or a module's `.hslider` (62 long, 8px capsule). They go off screen with the face when it auto-hides.
- Face reactions are requested by modules (`ctx.face.bounce/nod/shake/tilt/sing/blink/think`) and blended by the core. Modules never draw the face. While a module has usagi summoned, only its reactions move his face (no other module's, no audio kick); the rest resume when he's tucked back. `sing` is the exception: the timer's alarm still opens his mouth.
- The face tab is usagi's whole body: the tab is the bottom 48px of his 84px head, with the rest of it and his ears (inner ears in the tongue color, two #aba2a2 earrings on the right) above the screen edge. The ears are 200px, longer than the island, so their tips never show: they seem to go on forever. A module that returns `summon: { label, click }` (Ask usagi) brings him out: while it's showing the tab slides straight down 118px, never scaled, until his chin is 22px off the island's bottom (the content inset every module uses), and clicking him calls `click` instead of closing. Scrolling away tucks him back up into the close button. Reactions move only his face, inside his head, never the head itself.
- Audio drives the face: the kick bobs the head. The mouth (tongue) opens only on `ctx.face.sing`, used by the timer's alarm; system-audio vocals don't move it.

## Rules for changes

- New UI capability → a module, not a core change, unless every module needs it.
- New setting → default in `prefs.js`, applied in `app.js` with `prefs.watch`, a row on the right page in `settings.js`, and its key in that page's reset list.
- Modules can't change the island's size; `rotation.js` only honors `size()` from Settings, which uses it for its category pages.
- New OS capability → a `#[tauri::command]` in `main.rs`, implemented in each of `win.rs`, `mac.rs`, `linux.rs` (return an error where unsupported), wired through `ui/core/bridge.js`, and exposed via `ctx.system`.
- Keep all three platforms compiling. Gate platform code with `#[cfg(...)]`.
- Click-through depends on `island.js` hit-testing: anything clickable must sit inside the island.
