// Windows: GlobalSystemMediaTransportControls (anything in the media flyout —
// Spotify, browsers, etc.) and Core Audio for master volume.

use base64::Engine;
use windows::core::Interface;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication, DXGI_ERROR_WAIT_TIMEOUT,
    DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
    SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HALFTONE, HDC, SRCCOPY,
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

/// Copies `r` off the screen into a `w`×`h` top-down BGRA buffer, averaging
/// pixels down (halftone) when that is smaller than `r`.
unsafe fn grab(screen: HDC, mem: HDC, r: &Rect, w: i32, h: i32) -> Result<Vec<u8>, String> {
    let bitmap = CreateCompatibleBitmap(screen, w, h);
    let old = SelectObject(mem, bitmap.into());
    let copied = if (w, h) == (r.w, r.h) {
        BitBlt(mem, 0, 0, w, h, Some(screen), r.x, r.y, SRCCOPY)
    } else {
        SetStretchBltMode(mem, HALFTONE);
        let _ = SetBrushOrgEx(mem, 0, 0, None);
        StretchBlt(mem, 0, 0, w, h, Some(screen), r.x, r.y, r.w, r.h, SRCCOPY).ok()
    };
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
    Ok(px)
}

/// Runs `f` with a screen DC and a memory DC to copy into.
fn with_screen<T>(f: impl FnOnce(HDC, HDC) -> Result<T, String>) -> Result<T, String> {
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("no screen DC".into());
        }
        let mem = CreateCompatibleDC(Some(screen));
        let result = f(screen, mem);
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        result
    }
}

/// How long `Backdrop::next` waits for the screen to change.
const FRAME_WAIT_MS: u32 = 16;
/// Pace of the GDI fallback, which can't tell when the screen changed.
const GDI_FRAME: std::time::Duration = std::time::Duration::from_millis(33);

/// Live copies of the screen under a rect, for the glass background. Uses
/// Desktop Duplication, which hands over each frame as soon as it's composed;
/// falls back to GDI copies (slower, polled) where duplication isn't allowed.
/// Needs usagi hidden from capture first, or it reads back the island itself.
pub struct Backdrop {
    at: Rect,
    dupl: Option<Dupl>,
    last: Vec<u8>,
}

impl Backdrop {
    pub fn open(at: Rect) -> Result<Self, String> {
        Ok(Self { at, dupl: Dupl::new(at.x, at.y).ok(), last: Vec::new() })
    }

    /// Waits briefly for the screen to change; then returns what's under `r`,
    /// shrunk to `w`×`h` BGRA, if it differs from the last copy (or `force`).
    pub fn next(&mut self, r: Rect, w: i32, h: i32, force: bool) -> Result<Option<Vec<u8>>, String> {
        let px = match &mut self.dupl {
            Some(d) => match d.acquire() {
                Ok(true) => d.crop(r, w, h).map_err(err)?,
                Ok(false) if force => d.crop(r, w, h).map_err(err)?,
                Ok(false) => return Ok(None),
                // display mode change, secure desktop (UAC)...: start over next time
                Err(_) => {
                    self.dupl = None;
                    return Ok(None);
                }
            },
            None => {
                std::thread::sleep(GDI_FRAME);
                if let Ok(d) = Dupl::new(self.at.x, self.at.y) {
                    self.dupl = Some(d);
                    return Ok(None);
                }
                let r = Rect { w: r.w.max(1), h: r.h.max(1), ..r };
                with_screen(|screen, mem| unsafe { grab(screen, mem, &r, w, h) })?
            }
        };
        if !force && px == self.last {
            return Ok(None);
        }
        self.last.clone_from(&px);
        Ok(Some(px))
    }
}

/// Desktop Duplication of the display that holds a point.
struct Dupl {
    ctx: ID3D11DeviceContext,
    device: ID3D11Device,
    dupl: IDXGIOutputDuplication,
    origin: (i32, i32),
    size: (i32, i32),
    /// The latest frame, kept so the island can move over a still screen.
    frame: ID3D11Texture2D,
    staging: Option<(ID3D11Texture2D, i32, i32)>,
}

fn texture(device: &ID3D11Device, w: i32, h: i32, staging: bool) -> windows::core::Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: w as u32,
        Height: h as u32,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: if staging { D3D11_USAGE_STAGING } else { D3D11_USAGE_DEFAULT },
        CPUAccessFlags: if staging { D3D11_CPU_ACCESS_READ.0 as u32 } else { 0 },
        ..Default::default()
    };
    let mut tex = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut tex)) }?;
    tex.ok_or_else(windows::core::Error::from_thread)
}

impl Dupl {
    fn new(x: i32, y: i32) -> windows::core::Result<Self> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
            let mut a = 0;
            // EnumAdapters1 errors past the last adapter, ending the search
            loop {
                let adapter = factory.EnumAdapters1(a)?;
                let mut o = 0;
                while let Ok(output) = adapter.EnumOutputs(o) {
                    o += 1;
                    let desc = output.GetDesc()?;
                    let rc = desc.DesktopCoordinates;
                    if !desc.AttachedToDesktop.as_bool() || x < rc.left || x >= rc.right || y < rc.top || y >= rc.bottom
                    {
                        continue;
                    }
                    // duplication needs a device on the adapter that drives this display
                    let mut device = None;
                    let mut ctx = None;
                    D3D11CreateDevice(
                        &adapter,
                        D3D_DRIVER_TYPE_UNKNOWN,
                        HMODULE::default(),
                        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                        None,
                        D3D11_SDK_VERSION,
                        Some(&mut device),
                        None,
                        Some(&mut ctx),
                    )?;
                    let (Some(device), Some(ctx)) = (device, ctx) else {
                        return Err(windows::core::Error::from_thread());
                    };
                    let dupl = output.cast::<IDXGIOutput1>()?.DuplicateOutput(&device)?;
                    let size = (rc.right - rc.left, rc.bottom - rc.top);
                    let frame = texture(&device, size.0, size.1, false)?;
                    return Ok(Self { ctx, device, dupl, origin: (rc.left, rc.top), size, frame, staging: None });
                }
                a += 1;
            }
        }
    }

    /// Takes the next frame if the screen changed; false on timeout or a
    /// cursor-only update.
    fn acquire(&mut self) -> windows::core::Result<bool> {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut res = None;
        unsafe {
            match self.dupl.AcquireNextFrame(FRAME_WAIT_MS, &mut info, &mut res) {
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(false),
                r => r?,
            }
            let fresh = info.LastPresentTime != 0;
            if fresh {
                if let Some(res) = &res {
                    self.ctx.CopyResource(&self.frame, &res.cast::<ID3D11Texture2D>()?);
                }
            }
            self.dupl.ReleaseFrame()?;
            Ok(fresh)
        }
    }

    /// The part of the latest frame under `r`, box-filtered down to `w`×`h`.
    /// Anything off this display (above the top edge...) reads as black.
    fn crop(&mut self, r: Rect, w: i32, h: i32) -> windows::core::Result<Vec<u8>> {
        let mut out = vec![0u8; (w * h * 4) as usize];
        let x0 = (r.x - self.origin.0).clamp(0, self.size.0);
        let y0 = (r.y - self.origin.1).clamp(0, self.size.1);
        let x1 = (r.x + r.w - self.origin.0).clamp(0, self.size.0);
        let y1 = (r.y + r.h - self.origin.1).clamp(0, self.size.1);
        let (bw, bh) = (x1 - x0, y1 - y0);
        if bw <= 0 || bh <= 0 {
            return Ok(out);
        }
        // staging only grows, so the island's open animation doesn't reallocate every frame
        let fits = matches!(self.staging, Some((_, sw, sh)) if sw >= bw && sh >= bh);
        if !fits {
            let (sw, sh) = self.staging.as_ref().map_or((0, 0), |s| (s.1, s.2));
            let (sw, sh) = (sw.max(bw), sh.max(bh));
            self.staging = Some((texture(&self.device, sw, sh, true)?, sw, sh));
        }
        let staging = &self.staging.as_ref().unwrap().0;
        let region =
            D3D11_BOX { left: x0 as u32, top: y0 as u32, front: 0, right: x1 as u32, bottom: y1 as u32, back: 1 };
        unsafe {
            self.ctx.CopySubresourceRegion(staging, 0, 0, 0, 0, &self.frame, 0, Some(&region));
            let mut map = D3D11_MAPPED_SUBRESOURCE::default();
            self.ctx.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut map))?;
            let pitch = map.RowPitch as usize;
            let src = std::slice::from_raw_parts(map.pData as *const u8, pitch * bh as usize);
            // where the copied box sits inside r
            let (ox, oy) = (x0 + self.origin.0 - r.x, y0 + self.origin.1 - r.y);
            for ty in 0..h {
                let sy0 = ty * r.h / h;
                let sy1 = ((ty + 1) * r.h / h).max(sy0 + 1);
                for tx in 0..w {
                    let sx0 = tx * r.w / w;
                    let sx1 = ((tx + 1) * r.w / w).max(sx0 + 1);
                    let mut sum = [0u32; 3];
                    for sy in sy0.max(oy)..sy1.min(oy + bh) {
                        let row = (sy - oy) as usize * pitch;
                        for sx in sx0.max(ox)..sx1.min(ox + bw) {
                            let p = row + (sx - ox) as usize * 4;
                            sum[0] += src[p] as u32;
                            sum[1] += src[p + 1] as u32;
                            sum[2] += src[p + 2] as u32;
                        }
                    }
                    let n = ((sx1 - sx0) * (sy1 - sy0)) as u32;
                    let o = ((ty * w + tx) * 4) as usize;
                    out[o] = (sum[0] / n) as u8;
                    out[o + 1] = (sum[1] / n) as u8;
                    out[o + 2] = (sum[2] / n) as u8;
                    out[o + 3] = 255;
                }
            }
            self.ctx.Unmap(staging, 0);
        }
        Ok(out)
    }
}
