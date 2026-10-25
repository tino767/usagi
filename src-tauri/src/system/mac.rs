// macOS: Spotify and Apple Music through AppleScript, volume through
// `osascript`. (Apple locked the private MediaRemote framework to its own apps
// in macOS 15.4, so per-app scripting is the dependable route.)
// The first call asks for Automation permission per app.

use std::process::Command;
use std::sync::Mutex;

use super::{Media, Rect};

const SEP: char = '\u{1f}';

static LAST_APP: Mutex<Option<String>> = Mutex::new(None);
static LAST_ART: Mutex<Option<String>> = Mutex::new(None);

const NOW_PLAYING: &str = r#"
set sep to (ASCII character 31)
set res to ""
if application "Spotify" is running then
  try
    tell application "Spotify"
      set res to "Spotify" & sep & (player state as string) & sep & (name of current track) & sep & (artist of current track) & sep & (album of current track) & sep & (artwork url of current track)
    end tell
  end try
  if res contains (sep & "playing" & sep) then return res
end if
if application "Music" is running then
  try
    tell application "Music"
      if player state is not stopped then
        return "Music" & sep & (player state as string) & sep & (name of current track) & sep & (artist of current track) & sep & (album of current track) & sep & ""
      end if
    end tell
  end try
end if
return res
"#;

fn osascript(script: &str) -> Result<String, String> {
    let out = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string())
}

pub fn media() -> Result<Media, String> {
    let raw = osascript(NOW_PLAYING)?;
    let f: Vec<&str> = raw.split(SEP).collect();
    if f.len() < 6 || f[0].is_empty() {
        *LAST_ART.lock().unwrap() = None;
        return Ok(Media::default());
    }
    *LAST_APP.lock().unwrap() = Some(f[0].to_string());
    *LAST_ART.lock().unwrap() = (!f[5].is_empty()).then(|| f[5].to_string());
    Ok(Media {
        available: true,
        app: f[0].to_string(),
        playing: f[1] == "playing",
        title: f[2].to_string(),
        artist: f[3].to_string(),
        album: f[4].to_string(),
        thumbnail: None,
    })
}

pub fn thumbnail() -> Option<String> {
    LAST_ART.lock().unwrap().clone()
}

pub fn media_command(cmd: &str) -> Result<bool, String> {
    let Some(app) = LAST_APP.lock().unwrap().clone() else { return Ok(false) };
    let verb = match cmd {
        "toggle" => "playpause",
        "next" => "next track",
        "prev" => "previous track",
        _ => return Ok(false),
    };
    osascript(&format!("tell application \"{app}\" to {verb}"))?;
    Ok(true)
}

pub fn volume() -> Result<f32, String> {
    let raw = osascript("output volume of (get volume settings)")?;
    raw.trim().parse::<f32>().map(|v| v / 100.0).map_err(|_| format!("unexpected volume: {raw}"))
}

pub fn set_volume(v: f32) -> Result<(), String> {
    osascript(&format!("set volume output volume {}", (v * 100.0).round() as i32)).map(|_| ())
}

/// Live copies of the screen under a rect, for the glass background.
pub struct Backdrop;

impl Backdrop {
    pub fn open(_at: Rect) -> Result<Self, String> {
        Err("unsupported".into())
    }

    pub fn next(&mut self, _r: Rect, _w: i32, _h: i32, _force: bool) -> Result<Option<Vec<u8>>, String> {
        Ok(None)
    }
}
