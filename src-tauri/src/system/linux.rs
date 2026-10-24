// Linux: MPRIS over D-Bus (Spotify, browsers, VLC, mpv with mpris, …) and
// PipeWire/PulseAudio volume via `wpctl`, falling back to `pactl`.

use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;

use base64::Engine;
use zbus::blocking::{fdo::DBusProxy, Connection, Proxy};
use zbus::zvariant::{OwnedValue, Value};

use super::{Media, Rect};

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const IFACE: &str = "org.mpris.MediaPlayer2.Player";
const MAX_ART_BYTES: u64 = 4 * 1024 * 1024;

static CONN: Mutex<Option<Connection>> = Mutex::new(None);
static LAST_PLAYER: Mutex<Option<String>> = Mutex::new(None);
static LAST_ART: Mutex<Option<String>> = Mutex::new(None);

fn conn() -> Result<Connection, String> {
    let mut slot = CONN.lock().unwrap();
    if let Some(c) = slot.as_ref() {
        return Ok(c.clone());
    }
    let c = Connection::session().map_err(|e| e.to_string())?;
    *slot = Some(c.clone());
    Ok(c)
}

fn player<'a>(c: &Connection, name: &str) -> zbus::Result<Proxy<'a>> {
    Proxy::new(c, name.to_owned(), PATH, IFACE)
}

fn text(v: &Value) -> Option<String> {
    match v {
        Value::Str(s) => Some(s.to_string()),
        Value::Array(a) => {
            let parts: Vec<String> = a.iter().filter_map(text).collect();
            (!parts.is_empty()).then(|| parts.join(", "))
        }
        Value::Value(inner) => text(inner),
        _ => None,
    }
}

struct Found {
    name: String,
    status: String,
    meta: HashMap<String, OwnedValue>,
}

fn find_player(c: &Connection) -> Result<Option<Found>, String> {
    let names = DBusProxy::new(c)
        .map_err(|e| e.to_string())?
        .list_names()
        .map_err(|e| e.to_string())?;
    let mut found: Vec<Found> = names
        .into_iter()
        .map(|n| n.to_string())
        .filter(|n| n.starts_with(PREFIX))
        .filter_map(|name| {
            let p = player(c, &name).ok()?;
            let status: String = p.get_property("PlaybackStatus").ok()?;
            let meta: HashMap<String, OwnedValue> = p.get_property("Metadata").unwrap_or_default();
            Some(Found { name, status, meta })
        })
        .collect();
    let rank = |s: &str| match s {
        "Playing" => 0,
        "Paused" => 1,
        _ => 2,
    };
    found.sort_by_key(|f| rank(&f.status));
    Ok(found.into_iter().next())
}

pub fn media() -> Result<Media, String> {
    let c = conn()?;
    let Some(f) = find_player(&c)? else {
        *LAST_PLAYER.lock().unwrap() = None;
        *LAST_ART.lock().unwrap() = None;
        return Ok(Media::default());
    };
    let get = |k: &str| f.meta.get(k).and_then(|v| text(v)).unwrap_or_default();
    *LAST_PLAYER.lock().unwrap() = Some(f.name.clone());
    let art = get("mpris:artUrl");
    *LAST_ART.lock().unwrap() = (!art.is_empty()).then_some(art);
    Ok(Media {
        available: true,
        title: get("xesam:title"),
        artist: get("xesam:artist"),
        album: get("xesam:album"),
        app: f.name.trim_start_matches(PREFIX).to_string(),
        playing: f.status == "Playing",
        thumbnail: None,
    })
}

pub fn thumbnail() -> Option<String> {
    let url = LAST_ART.lock().unwrap().clone()?;
    if url.starts_with("https://") || url.starts_with("http://") || url.starts_with("data:") {
        return Some(url);
    }
    let path = percent_decode(url.strip_prefix("file://")?);
    if std::fs::metadata(&path).ok()?.len() > MAX_ART_BYTES {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let mime = match path.rsplit('.').next().map(|e| e.to_ascii_lowercase()) {
        Some(e) if e == "png" => "image/png",
        Some(e) if e == "webp" => "image/webp",
        _ => "image/jpeg",
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn media_command(cmd: &str) -> Result<bool, String> {
    let Some(name) = LAST_PLAYER.lock().unwrap().clone() else { return Ok(false) };
    let method = match cmd {
        "toggle" => "PlayPause",
        "next" => "Next",
        "prev" => "Previous",
        _ => return Ok(false),
    };
    let c = conn()?;
    player(&c, &name)
        .and_then(|p| p.call_method(method, &()))
        .map(|_| true)
        .map_err(|e| e.to_string())
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn volume() -> Result<f32, String> {
    // wpctl: "Volume: 0.62" (optionally followed by "[MUTED]")
    if let Some(out) = run("wpctl", &["get-volume", "@DEFAULT_AUDIO_SINK@"]) {
        if let Some(v) = out.split_whitespace().nth(1).and_then(|v| v.parse::<f32>().ok()) {
            return Ok(v.min(1.0));
        }
    }
    // pactl: "Volume: front-left: 40632 /  62% / …"
    if let Some(out) = run("pactl", &["get-sink-volume", "@DEFAULT_SINK@"]) {
        if let Some(pct) = out.split_whitespace().find_map(|w| w.strip_suffix('%')?.parse::<f32>().ok()) {
            return Ok((pct / 100.0).min(1.0));
        }
    }
    Err("no wpctl or pactl".into())
}

pub fn set_volume(v: f32) -> Result<(), String> {
    let v = v.clamp(0.0, 1.0);
    if run("wpctl", &["set-volume", "@DEFAULT_AUDIO_SINK@", &format!("{v:.2}")]).is_some() {
        return Ok(());
    }
    let pct = format!("{}%", (v * 100.0).round() as i32);
    run("pactl", &["set-sink-volume", "@DEFAULT_SINK@", &pct])
        .map(|_| ())
        .ok_or_else(|| "no wpctl or pactl".into())
}

// TODO: XGetImage on X11; Wayland has no way to read other windows.
pub fn backdrop_luma(_rects: &[Rect]) -> Result<Vec<f32>, String> {
    Err("unsupported".into())
}
