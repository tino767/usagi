// The overlay window: top-center placement, click-through, cursor feed,
// and keeping usagi above everything else.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, LogicalSize, PhysicalPosition, WebviewWindow};

/// Size of the overlay in CSS pixels. Wide enough for the open island + side rails.
pub const WIDTH: f64 = 760.0;
pub const HEIGHT: f64 = 340.0;
/// Overall scale of usagi on screen. The webview is zoomed and the window
/// shrunk by the same factor, so the UI still lays out at WIDTH×HEIGHT.
pub const ZOOM: f64 = 0.8;

const CURSOR_POLL: Duration = Duration::from_millis(50);
const GUARD_POLL: Duration = Duration::from_millis(1000);

/// Hide usagi while a fullscreen app (game, video, presentation) is in front.
pub static HIDE_IN_FULLSCREEN: AtomicBool = AtomicBool::new(true);

#[derive(Clone, Serialize)]
struct Cursor {
    x: f64,
    y: f64,
}

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_zoom(ZOOM)?;
    place(window)?;
    window.set_always_on_top(true)?;
    window.set_visible_on_all_workspaces(true)?;
    platform::raise(window);
    // Show before going click-through: on Linux the native window must exist first.
    window.show()?;
    window.set_ignore_cursor_events(true)?;

    // Cursor position, relative to the window in CSS pixels. Keeps proximity
    // detection working while the window is click-through.
    let w = window.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(CURSOR_POLL);
        let (Ok(c), Ok(p), Ok(s)) = (w.cursor_position(), w.outer_position(), w.scale_factor()) else {
            continue;
        };
        let s = s * ZOOM;
        let _ = w.emit("cursor", Cursor { x: (c.x - p.x as f64) / s, y: (c.y - p.y as f64) / s });
    });

    // Re-place on display changes, stay on top, hide over fullscreen apps.
    let w = window.clone();
    std::thread::spawn(move || {
        let mut last_monitor = None;
        let mut hidden = false;
        loop {
            std::thread::sleep(GUARD_POLL);
            if let Ok(Some(m)) = w.primary_monitor() {
                let geo = (m.position().x, m.position().y, m.size().width, m.size().height);
                if last_monitor != Some(geo) {
                    if last_monitor.is_some() {
                        let _ = place(&w);
                    }
                    last_monitor = Some(geo);
                }
            }
            let hide = HIDE_IN_FULLSCREEN.load(Ordering::Relaxed) && platform::fullscreen_app_in_front();
            if hide != hidden {
                hidden = hide;
                let _ = if hide { w.hide() } else { w.show() };
            }
            if !hidden {
                platform::reassert_topmost(&w);
            }
        }
    });
    Ok(())
}

/// Top center of the primary display, flush with the top edge.
pub fn place(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(m) = window.primary_monitor()? else { return Ok(()) };
    let scale = m.scale_factor();
    window.set_size(LogicalSize::new(WIDTH * ZOOM, HEIGHT * ZOOM))?;
    let width = (WIDTH * ZOOM * scale).round() as i32;
    let x = m.position().x + (m.size().width as i32 - width) / 2;
    window.set_position(PhysicalPosition::new(x, m.position().y))?;
    Ok(())
}

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    };

    pub fn raise(window: &WebviewWindow) {
        reassert_topmost(window);
    }

    /// Other always-on-top apps can push usagi down; claim the top again.
    pub fn reassert_topmost(window: &WebviewWindow) {
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                );
            }
        }
    }

    pub fn fullscreen_app_in_front() -> bool {
        match unsafe { SHQueryUserNotificationState() } {
            Ok(state) => state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE,
            Err(_) => false,
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::WebviewWindow;

    // NSPopUpMenuWindowLevel: above the menu bar, so usagi can sit in the notch.
    const LEVEL: isize = 101;
    // canJoinAllSpaces | stationary | fullScreenAuxiliary
    const BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 8);

    pub fn raise(window: &WebviewWindow) {
        let Ok(ptr) = window.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        // Runs on the main thread (called from setup).
        unsafe {
            let ns: &AnyObject = &*(ptr as *const AnyObject);
            let _: () = msg_send![ns, setLevel: LEVEL];
            let _: () = msg_send![ns, setCollectionBehavior: BEHAVIOR];
            let _: () = msg_send![ns, setHasShadow: false];
        }
    }

    pub fn reassert_topmost(_window: &WebviewWindow) {}

    // TODO: detect fullscreen apps on macOS (CGWindowList bounds vs. screen).
    pub fn fullscreen_app_in_front() -> bool {
        false
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use tauri::WebviewWindow;

    pub fn raise(_window: &WebviewWindow) {}

    pub fn reassert_topmost(_window: &WebviewWindow) {}

    // TODO: _NET_WM_STATE_FULLSCREEN on the active X11 window.
    pub fn fullscreen_app_in_front() -> bool {
        false
    }
}
