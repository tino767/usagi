// usagi — Tauri backend.
// Owns the overlay window, click-through, cursor tracking, the tray, and the
// bridge to the OS (media session, volume, system-audio bass).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod overlay;
mod system;

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
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

/// Mean luminance of the screen under each rect, so the side rails can pick
/// black or white against whatever is behind them.
#[tauri::command]
async fn backdrop_luma(window: WebviewWindow, rects: Vec<CssRect>) -> Result<Vec<f32>, String> {
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    let s = window.scale_factor().map_err(|e| e.to_string())? * overlay::ZOOM;
    let rects: Vec<system::Rect> = rects
        .iter()
        .map(|r| system::Rect {
            x: origin.x + (r.x * s).round() as i32,
            y: origin.y + (r.y * s).round() as i32,
            w: (r.w * s).round() as i32,
            h: (r.h * s).round() as i32,
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || system::backdrop_luma(&rects))
        .await
        .map_err(|e| e.to_string())?
}

// ---------- tray ----------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let label = if cfg!(target_os = "macos") { "Open usagi  (⌘⌥U)" } else { "Open usagi  (Ctrl+Alt+U)" };
    let open = MenuItem::with_id(app, "open", label, true, None::<&str>)?;
    let hide_fs = CheckMenuItem::with_id(
        app,
        "hide_fullscreen",
        "Hide when a fullscreen app is in front",
        cfg!(windows),
        overlay::HIDE_IN_FULLSCREEN.load(Ordering::Relaxed),
        None::<&str>,
    )?;
    let login = CheckMenuItem::with_id(
        app,
        "login",
        "Launch at login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
    let devtools = MenuItem::with_id(app, "devtools", "Developer tools", cfg!(debug_assertions), None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit usagi", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep1, &hide_fs, &login, &reload, &devtools, &sep2, &quit])?;

    let mut tray = TrayIconBuilder::with_id("usagi")
        .tooltip("usagi")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                let _ = app.emit("toggle", ());
            }
            "hide_fullscreen" => {
                let on = !overlay::HIDE_IN_FULLSCREEN.load(Ordering::Relaxed);
                overlay::HIDE_IN_FULLSCREEN.store(on, Ordering::Relaxed);
                let _ = hide_fs.set_checked(on);
            }
            "login" => {
                let auto = app.autolaunch();
                let enabled = auto.is_enabled().unwrap_or(false);
                let _ = if enabled { auto.disable() } else { auto.enable() };
                let _ = login.set_checked(auto.is_enabled().unwrap_or(false));
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
        .invoke_handler(tauri::generate_handler![
            set_interactive,
            media_get,
            media_command,
            volume_get,
            volume_set,
            backdrop_luma
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
