// usagi — Tauri backend.
// Owns the overlay window, click-through, cursor tracking, the tray, and the
// bridge to the OS (media session, volume, system-audio levels).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod overlay;
mod system;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::ShortcutState;

use system::Media;

const TOGGLE_SHORTCUT: &str = "CommandOrControl+Alt+U";
const MEDIA_POLL: Duration = Duration::from_millis(1000);

/// Last media state, with artwork cached per track.
#[derive(Default)]
struct MediaState(Mutex<Option<Media>>);

fn refresh_media(app: &AppHandle) {
    let Ok(mut next) = system::media() else { return };
    let state = app.state::<MediaState>();
    let mut last = state.0.lock().unwrap();
    let same_track = last.as_ref().map(|m| m.key() == next.key()).unwrap_or(false);
    next.thumbnail = if same_track {
        last.as_ref().and_then(|m| m.thumbnail.clone())
    } else if next.available {
        system::thumbnail()
    } else {
        None
    };
    if last.as_ref() != Some(&next) {
        let _ = app.emit("media", &next);
        *last = Some(next);
    }
}

// ---------- commands (called from ui/core/bridge.js) ----------

#[tauri::command]
fn set_interactive(window: WebviewWindow, interactive: bool) {
    let _ = window.set_ignore_cursor_events(!interactive);
}

#[tauri::command]
fn media_get(state: tauri::State<'_, MediaState>) -> Option<Media> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn media_command(app: AppHandle, cmd: String) -> Result<bool, String> {
    if !matches!(cmd.as_str(), "toggle" | "next" | "prev") {
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let ok = system::media_command(&cmd)?;
        std::thread::sleep(Duration::from_millis(150));
        refresh_media(&app);
        Ok(ok)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn volume_get() -> Result<f32, String> {
    tauri::async_runtime::spawn_blocking(system::volume)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn volume_set(value: f32) -> Result<(), String> {
    if !value.is_finite() {
        return Err("invalid volume".into());
    }
    tauri::async_runtime::spawn_blocking(move || system::set_volume(value.clamp(0.0, 1.0)))
        .await
        .map_err(|e| e.to_string())?
}

/// A window-relative rect in CSS pixels, as the UI measures it.
#[derive(serde::Deserialize)]
struct CssRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl CssRect {
    /// Physical screen pixels.
    fn to_screen(&self, window: &WebviewWindow) -> Result<system::Rect, String> {
        let origin = window.outer_position().map_err(|e| e.to_string())?;
        let s = window.scale_factor().map_err(|e| e.to_string())?;
        Ok(system::Rect {
            x: origin.x + (self.x * s).round() as i32,
            y: origin.y + (self.y * s).round() as i32,
            w: (self.w * s).round() as i32,
            h: (self.h * s).round() as i32,
        })
    }
}

/// Mean luminance of the screen under each rect, so the side rails can pick
/// black or white against whatever is behind them.
#[tauri::command]
async fn backdrop_luma(window: WebviewWindow, rects: Vec<CssRect>) -> Result<Vec<f32>, String> {
    let rects = rects.iter().map(|r| r.to_screen(&window)).collect::<Result<Vec<_>, _>>()?;
    tauri::async_runtime::spawn_blocking(move || system::backdrop_luma(&rects))
        .await
        .map_err(|e| e.to_string())?
}

/// What the glass background is showing: the screen rect behind the island,
/// the size to shrink it to, and where to send frames. `target` None = stop.
#[derive(Default)]
struct GlassState(Arc<Mutex<Glass>>);

#[derive(Default)]
struct Glass {
    target: Option<(system::Rect, i32, i32)>,
    frames: Option<Channel<InvokeResponseBody>>,
    running: bool,
}

fn glass_target(window: &WebviewWindow, rect: &CssRect, out_w: i32, out_h: i32) -> Result<(system::Rect, i32, i32), String> {
    Ok((rect.to_screen(window)?, out_w.clamp(1, 512), out_h.clamp(1, 512)))
}

/// Glass background: stream the screen behind the island to `frames` as it
/// changes, each frame `[w u16 LE, h u16 LE]` + BGRA. usagi is hidden from
/// screen capture meanwhile, or the copy would be the island itself.
#[tauri::command]
async fn glass_start(
    window: WebviewWindow,
    state: tauri::State<'_, GlassState>,
    frames: Channel<InvokeResponseBody>,
    rect: CssRect,
    out_w: i32,
    out_h: i32,
) -> Result<(), String> {
    let target = glass_target(&window, &rect, out_w, out_h)?;
    {
        let mut g = state.0.lock().unwrap();
        g.target = Some(target);
        g.frames = Some(frames);
        if g.running {
            return Ok(());
        }
        g.running = true;
    }
    if let Err(e) = overlay::set_capture_hidden(&window, true) {
        state.0.lock().unwrap().running = false;
        return Err(e);
    }
    let shared = state.0.clone();
    let (ready, started) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut backdrop = match system::Backdrop::open(target.0) {
            Ok(b) => {
                let _ = ready.send(Ok(()));
                b
            }
            Err(e) => {
                shared.lock().unwrap().running = false;
                let _ = overlay::set_capture_hidden(&window, false);
                let _ = ready.send(Err(e));
                return;
            }
        };
        let mut last = None;
        loop {
            let (target, frames) = {
                let mut g = shared.lock().unwrap();
                match (g.target, g.frames.clone()) {
                    (Some(t), Some(f)) => (t, f),
                    _ => {
                        g.running = false;
                        break;
                    }
                }
            };
            let (r, w, h) = target;
            match backdrop.next(r, w, h, last != Some(target)) {
                Ok(Some(px)) => {
                    last = Some(target);
                    let mut msg = Vec::with_capacity(4 + px.len());
                    msg.extend_from_slice(&(w as u16).to_le_bytes());
                    msg.extend_from_slice(&(h as u16).to_le_bytes());
                    msg.extend_from_slice(&px);
                    let _ = frames.send(InvokeResponseBody::Raw(msg));
                }
                Ok(None) => {}
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
        }
        let _ = overlay::set_capture_hidden(&window, false);
    });
    tauri::async_runtime::spawn_blocking(move || started.recv().unwrap_or(Err("glass thread died".into())))
        .await
        .map_err(|e| e.to_string())?
}

/// Glass background: the island moved or resized.
#[tauri::command]
fn glass_move(window: WebviewWindow, state: tauri::State<'_, GlassState>, rect: CssRect, out_w: i32, out_h: i32) -> Result<(), String> {
    let target = glass_target(&window, &rect, out_w, out_h)?;
    let mut g = state.0.lock().unwrap();
    if g.target.is_some() {
        g.target = Some(target);
    }
    Ok(())
}

/// Glass background: stop streaming (the island closed or another background was picked).
#[tauri::command]
fn glass_stop(state: tauri::State<'_, GlassState>) {
    let mut g = state.0.lock().unwrap();
    g.target = None;
    g.frames = None;
}

/// Settings › Behavior: hide while a fullscreen app is in front (Windows).
#[tauri::command]
fn set_hide_fullscreen(on: bool) {
    overlay::HIDE_IN_FULLSCREEN.store(on, Ordering::Relaxed);
}

/// Settings › Behavior: launch at login.
#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let auto = app.autolaunch();
    if on { auto.enable() } else { auto.disable() }.map_err(|e| e.to_string())?;
    Ok(auto.is_enabled().unwrap_or(on))
}

// ---------- tray ----------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let label = if cfg!(target_os = "macos") { "Open usagi  (⌘⌥U)" } else { "Open usagi  (Ctrl+Alt+U)" };
    let open = MenuItem::with_id(app, "open", label, true, None::<&str>)?;
    // Behavior toggles (fullscreen hiding, launch at login) live in Settings.
    let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
    let devtools = MenuItem::with_id(app, "devtools", "Developer tools", cfg!(debug_assertions), None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit usagi", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep1, &reload, &devtools, &sep2, &quit])?;

    let mut tray = TrayIconBuilder::with_id("usagi")
        .tooltip("usagi")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                let _ = app.emit("toggle", ());
            }
            "reload" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval("location.reload()");
                }
            }
            "devtools" => {
                #[cfg(debug_assertions)]
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    // Wayland doesn't let apps position themselves or stay on top; run through XWayland.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.emit("toggle", ());
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([TOGGLE_SHORTCUT])
                .expect("valid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("toggle", ());
                    }
                })
                .build(),
        )
        .manage(MediaState::default())
        .manage(GlassState::default())
        .invoke_handler(tauri::generate_handler![
            set_interactive,
            media_get,
            media_command,
            volume_get,
            volume_set,
            backdrop_luma,
            glass_start,
            glass_move,
            glass_stop,
            set_hide_fullscreen,
            autostart_get,
            autostart_set
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app.get_webview_window("main").expect("main window");
            overlay::install(&window)?;
            build_tray(app.handle())?;
            audio::start(app.handle().clone());

            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                refresh_media(&handle);
                std::thread::sleep(MEDIA_POLL);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running usagi");
}
