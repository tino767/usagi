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

When asked to sync with the design, read the canvas with the Artifact tool and
port visual changes into `ui/`. When the UI changes in code, offer to update the
canvas to match. Visuals are owned by the canvas; behavior is owned by the code.

## Commands

- `npm run dev`: run the app (Tauri)
- `npm run preview`: UI only at http://localhost:5179 with a mock OS bridge. Use this to check UI work in a browser.
- `npm run build`: installers
- `cd src-tauri && cargo check`: backend type-check

## Layout

- `ui/core/`: framework (island state machine, face, rotation, manager, bridge). Modules never import from here except `icons.js`.
- `ui/modules/<id>/`: one folder per module; `_template` is the starting point. Folders starting with `_` are ignored.
- `src-tauri/src/overlay.rs`: window placement, click-through, cursor feed, stay-on-top, fullscreen hiding
- `src-tauri/src/system/{win,mac,linux}.rs`: media + volume per OS, same function signatures
- `src-tauri/src/audio.rs`: system-audio kick + vocal levels, sent to the UI as the `audio` event (`[kick, vocal]`)

## Design rules

- States: inactive (84×30 pill, r15), welcome (236×78, r39, eyes closed "= ㅅ ="), open (512×224, r80, white face tab 160×48 r24, eyes open "• ㅅ •"). Concave top fillets ("ears"): 22px (26px open), capped at h − r so they meet the bottom corner flush.
- Click the face to open; click it again to close. Scroll switches modules. The Modules page is always last.
- Side rails sit outside the island: left = module's rail (volume for media), right = module icon + position dots.
- Palette: island #000, paper #fff, surface #141414 / #1c1c1c, muted text #a6a6a6, tongue #E0606A. Font: Poppins 400/500/600 (bundled in `ui/fonts`).
- Content area inside the open island: 452×140 (left/right 30, top 62, bottom 22).
- Rails: 20px icon, 8px-wide capsule slider/dots (active dot 24px tall), 17px from the island's sides, top 74.
- Face reactions are requested by modules (`ctx.face.bounce/nod/tilt`) and blended by the core. Modules never draw the face.
- Audio drives the face: the kick bobs the head, vocals open the mouth (tongue). Nothing else opens the mouth.

## Rules for changes

- New UI capability → a module, not a core change, unless every module needs it.
- New OS capability → a `#[tauri::command]` in `main.rs`, implemented in each of `win.rs`, `mac.rs`, `linux.rs` (return an error where unsupported), wired through `ui/core/bridge.js`, and exposed via `ctx.system`.
- Keep all three platforms compiling. Gate platform code with `#[cfg(...)]`.
- Click-through depends on `island.js` hit-testing: anything clickable must sit inside the island or a rail.
