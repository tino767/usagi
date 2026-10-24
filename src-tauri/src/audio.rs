// Bass from system audio. A capture thread low-passes whatever is playing
// (≈150 Hz), turns it into a 0..1 "kick" level with automatic gain, and an
// emitter thread sends it to the UI as the `bass` event at ~60 Hz.
//
//   Windows  WASAPI loopback (cpal)
//   macOS    Core Audio process tap (cpal, macOS 14.2+; asks for permission)
//   Linux    `parec` on the default sink's monitor (PulseAudio / PipeWire)
//
// If capture isn't available no events are sent, and the UI falls back to a
// gentle fake beat while media is playing.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

static LEVEL: AtomicU32 = AtomicU32::new(0);
static UPDATED_MS: AtomicU64 = AtomicU64::new(0);
static ACTIVE: AtomicBool = AtomicBool::new(false);

const CUTOFF_HZ: f32 = 150.0;
const EMIT_EVERY: Duration = Duration::from_millis(16);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Two cascaded one-pole low-passes + envelope + automatic gain.
pub struct Detector {
    a: f32,
    lp1: f32,
    lp2: f32,
    peak: f32,
    level: f32,
}

impl Detector {
    pub fn new(sample_rate: f32) -> Self {
        let a = 1.0 - (-2.0 * std::f32::consts::PI * CUTOFF_HZ / sample_rate).exp();
        Self { a, lp1: 0.0, lp2: 0.0, peak: 0.02, level: 0.0 }
    }

    /// Feed interleaved samples; updates the shared level once per block.
    pub fn feed(&mut self, samples: impl Iterator<Item = f32>, channels: usize) {
        let channels = channels.max(1);
        let (mut sum, mut n, mut acc, mut i) = (0.0f32, 0usize, 0.0f32, 0usize);
        for s in samples {
            acc += s;
            i += 1;
            if i == channels {
                let x = acc / channels as f32;
                acc = 0.0;
                i = 0;
                self.lp1 += self.a * (x - self.lp1);
                self.lp2 += self.a * (self.lp1 - self.lp2);
                sum += self.lp2.abs();
                n += 1;
            }
        }
        if n == 0 {
            return;
        }
        let energy = sum / n as f32;
        self.peak = energy.max(self.peak * 0.997).max(0.004);
        let kick = ((energy / self.peak - 0.55) / 0.45).clamp(0.0, 1.0);
        self.level = if kick > self.level { kick } else { self.level * 0.9 };
        LEVEL.store(self.level.to_bits(), Ordering::Relaxed);
        UPDATED_MS.store(now_ms(), Ordering::Relaxed);
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(|| loop {
        if let Err(e) = capture() {
            if cfg!(debug_assertions) {
                eprintln!("[usagi] audio capture unavailable: {e}");
            }
        }
        ACTIVE.store(false, Ordering::Relaxed);
        std::thread::sleep(Duration::from_secs(5)); // device changed or not ready — retry
    });

    std::thread::spawn(move || {
        let mut last_sent = -1.0f32;
        let mut last_at = Instant::now();
        loop {
            std::thread::sleep(EMIT_EVERY);
            if !ACTIVE.load(Ordering::Relaxed) {
                continue;
            }
            let mut v = f32::from_bits(LEVEL.load(Ordering::Relaxed));
            // Silence often means no buffers at all; decay instead of freezing.
            if now_ms().saturating_sub(UPDATED_MS.load(Ordering::Relaxed)) > 120 {
                v *= 0.85;
                if v < 0.001 {
                    v = 0.0;
                }
                LEVEL.store(v.to_bits(), Ordering::Relaxed);
            }
            if (v - last_sent).abs() > 0.004 || last_at.elapsed() > Duration::from_millis(250) {
                let _ = app.emit("bass", v);
                last_sent = v;
                last_at = Instant::now();
            }
        }
    });
}

#[cfg(any(windows, target_os = "macos"))]
fn capture() -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::Arc;

    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("no output device")?;
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let channels = supported.channels() as usize;
    let sample_rate = supported.sample_rate() as f32;
    let config = supported.config();
    let failed = Arc::new(AtomicBool::new(false));

    // An input stream on an *output* device = loopback capture.
    macro_rules! stream {
        ($t:ty) => {{
            let mut det = Detector::new(sample_rate);
            let failed = failed.clone();
            device.build_input_stream(
                config.clone(),
                move |data: &[$t], _: &cpal::InputCallbackInfo| {
                    det.feed(data.iter().map(|s| cpal::Sample::to_sample::<f32>(*s)), channels)
                },
                // Glitches and reroutes are reported here too; only rebuild on real failures.
                move |e: cpal::Error| {
                    use cpal::ErrorKind::*;
                    if !matches!(e.kind(), Xrun | DeviceChanged | RealtimeDenied) {
                        if cfg!(debug_assertions) {
                            eprintln!("[usagi] audio stream error: {e}");
                        }
                        failed.store(true, Ordering::Relaxed);
                    }
                },
                None,
            )
        }};
    }
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => stream!(f32),
        cpal::SampleFormat::I16 => stream!(i16),
        cpal::SampleFormat::I32 => stream!(i32),
        cpal::SampleFormat::U16 => stream!(u16),
        other => return Err(format!("unsupported sample format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    ACTIVE.store(true, Ordering::Relaxed);

    let device_name = |d: &cpal::Device| d.id().map(|id| id.to_string()).unwrap_or_default();
    let current = device_name(&device);
    // Keep the stream alive; rebuild when it errors or the default output changes.
    loop {
        std::thread::sleep(Duration::from_secs(2));
        if failed.load(Ordering::Relaxed) {
            return Err("stream error".into());
        }
        if let Some(d) = host.default_output_device() {
            if device_name(&d) != current {
                return Ok(());
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn capture() -> Result<(), String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    const RATE: u32 = 11025;
    let mut child = Command::new("parec")
        .args(["--raw", "--format=s16le", "--channels=1", "--latency-msec=20", "-d", "@DEFAULT_MONITOR@"])
        .arg(format!("--rate={RATE}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("parec: {e}"))?;
    let mut out = child.stdout.take().ok_or("no stdout")?;
    let mut det = Detector::new(RATE as f32);
    let mut buf = [0u8; 440]; // ~20 ms
    ACTIVE.store(true, Ordering::Relaxed);
    loop {
        let n = out.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            let _ = child.wait();
            return Err("parec exited".into());
        }
        let samples = buf[..n - n % 2]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0);
        det.feed(samples, 1);
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn capture() -> Result<(), String> {
    Err("no capture backend for this platform".into())
}
