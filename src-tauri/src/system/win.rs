// Windows: GlobalSystemMediaTransportControls (anything in the media flyout —
// Spotify, browsers, etc.) and Core Audio for master volume.

use base64::Engine;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

use super::{Media, Rect};

const MAX_ART_BYTES: u32 = 4 * 1024 * 1024;

fn err(e: windows::core::Error) -> String {
    e.to_string()
}

fn session() -> Option<Session> {
    let manager = SessionManager::RequestAsync().ok()?.join().ok()?;
    manager.GetCurrentSession().ok()
}

pub fn media() -> Result<Media, String> {
    let Some(s) = session() else { return Ok(Media::default()) };
    let props = s.TryGetMediaPropertiesAsync().map_err(err)?.join().map_err(err)?;
    let playing = s
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == PlaybackStatus::Playing)
        .unwrap_or(false);
    Ok(Media {
        available: true,
        title: props.Title().map(|h| h.to_string()).unwrap_or_default(),
        artist: props.Artist().map(|h| h.to_string()).unwrap_or_default(),
        album: props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default(),
        app: s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default(),
        playing,
        thumbnail: None,
    })
}

pub fn thumbnail() -> Option<String> {
    let s = session()?;
    let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > MAX_ART_BYTES {
        return None;
    }
    let content_type = stream.ContentType().map(|h| h.to_string()).unwrap_or_else(|_| "image/png".into());
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{content_type};base64,{b64}"))
}

pub fn media_command(cmd: &str) -> Result<bool, String> {
    let Some(s) = session() else { return Ok(false) };
    let op = match cmd {
        "toggle" => s.TryTogglePlayPauseAsync(),
        "next" => s.TrySkipNextAsync(),
        "prev" => s.TrySkipPreviousAsync(),
        _ => return Ok(false),
    }
    .map_err(err)?;
    op.join().map_err(err)
}

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        // Commands run on worker threads; make sure COM is up (harmless if it already is).
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

pub fn volume() -> Result<f32, String> {
    let ep = endpoint().map_err(err)?;
    unsafe { ep.GetMasterVolumeLevelScalar() }.map_err(err)
}

pub fn set_volume(v: f32) -> Result<(), String> {
    let ep = endpoint().map_err(err)?;
    unsafe { ep.SetMasterVolumeLevelScalar(v, std::ptr::null()) }.map_err(err)
}

/// Copies each rect off the screen and averages its relative luminance.
pub fn backdrop_luma(rects: &[Rect]) -> Result<Vec<f32>, String> {
    let to_linear: Vec<f32> = (0..256)
        .map(|i| {
            let c = i as f32 / 255.0;
            if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
        })
        .collect();
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("no screen DC".into());
        }
        let mem = CreateCompatibleDC(Some(screen));
        let result = rects
            .iter()
            .map(|r| {
                let (w, h) = (r.w.max(1), r.h.max(1));
                let bitmap = CreateCompatibleBitmap(screen, w, h);
                let old = SelectObject(mem, bitmap.into());
                let copied = BitBlt(mem, 0, 0, w, h, Some(screen), r.x, r.y, SRCCOPY);
                SelectObject(mem, old);
                let mut info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: w,
                        biHeight: -h, // top-down
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut px = vec![0u8; (w * h * 4) as usize];
                let lines = GetDIBits(mem, bitmap, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
                let _ = DeleteObject(bitmap.into());
                copied.map_err(err)?;
                if lines == 0 {
                    return Err("GetDIBits failed".into());
                }
                // BGRA
                let sum: f32 = px
                    .chunks_exact(4)
                    .map(|p| {
                        0.0722 * to_linear[p[0] as usize] + 0.7152 * to_linear[p[1] as usize] + 0.2126 * to_linear[p[2] as usize]
                    })
                    .sum();
                Ok(sum / (w * h) as f32)
            })
            .collect();
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        result
    }
}
