// OS bridge. Each platform file provides the same functions:
//   media()            -> what's playing right now (without artwork)
//   thumbnail()        -> artwork for the current track as a data: or https: URL
//   media_command(cmd) -> "toggle" | "next" | "prev"
//   volume() / set_volume(v)   master output volume, 0.0..=1.0
//   Backdrop::open(at) / next(rect, w, h, force) -> live copies of the screen
//     under rect, shrunk to w×h BGRA, as it changes (glass background)

use serde::Serialize;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub available: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub app: String,
    pub playing: bool,
    pub thumbnail: Option<String>,
}

/// A rectangle on screen, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Media {
    pub fn key(&self) -> String {
        format!("{}\u{1f}{}\u{1f}{}", self.app, self.title, self.artist)
    }
}

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::*;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
pub use mac::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
mod fallback {
    use super::Media;
    pub fn media() -> Result<Media, String> { Ok(Media::default()) }
    pub fn thumbnail() -> Option<String> { None }
    pub fn media_command(_cmd: &str) -> Result<bool, String> { Ok(false) }
    pub fn volume() -> Result<f32, String> { Err("unsupported".into()) }
    pub fn set_volume(_v: f32) -> Result<(), String> { Err("unsupported".into()) }
    pub struct Backdrop;
    impl Backdrop {
        pub fn open(_at: super::Rect) -> Result<Self, String> { Err("unsupported".into()) }
        pub fn next(&mut self, _r: super::Rect, _w: i32, _h: i32, _f: bool) -> Result<Option<Vec<u8>>, String> { Ok(None) }
    }
}
#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub use fallback::*;
