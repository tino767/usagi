// Kick and vocals from system audio. A capture thread analyses whatever is
// playing in 5 ms hops and an emitter thread sends `[kick, vocal]` (each 0..1)
// to the UI as the `audio` event at ~60 Hz.
//
//   kick   onsets below ≈110 Hz: the low end jumping above its recent average,
//          so a sustained bass line doesn't count, only the hit.
//   vocal  the centre channel (mid minus side) in the 300 Hz – 3 kHz voice band,
//          measured against a slowly rising floor so held pads and chords fade
//          out and syllables stand out. A heuristic, not source separation.
//
//   Windows  WASAPI loopback (cpal)
//   macOS    Core Audio process tap (cpal, macOS 14.2+; asks for permission)
//   Linux    `parec` on the default sink's monitor (PulseAudio / PipeWire)
//
// If capture isn't available no events are sent, and the UI falls back to a
// gentle fake beat while media is playing.

use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

static KICK: AtomicU32 = AtomicU32::new(0);
static VOCAL: AtomicU32 = AtomicU32::new(0);
static UPDATED_MS: AtomicU64 = AtomicU64::new(0);
static ACTIVE: AtomicBool = AtomicBool::new(false);

const KICK_HZ: f32 = 110.0;
const VOICE_LO_HZ: f32 = 300.0;
const VOICE_HI_HZ: f32 = 3000.0;
const HOP_SECS: f32 = 0.005;
const EMIT_EVERY: Duration = Duration::from_millis(16);

// Per-hop rates, so the feel doesn't depend on the device's sample rate.
const PEAK_DECAY: f32 = 0.9983; //  auto-gain forgets over ~3 s
const KICK_AVG: f32 = 0.04; //      "recent" low end ≈ last 125 ms
const KICK_RELEASE: f32 = 0.955; // bob falls back over ~110 ms
const FLOOR_RISE: f32 = 0.006; //   held notes sink into the floor over ~0.8 s

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// One-pole filter; `hp` is the matching high-pass.
#[derive(Clone, Copy)]
struct OnePole {
    a: f32,
    y: f32,
}

impl OnePole {
    fn new(hz: f32, sample_rate: f32) -> Self {
        Self { a: 1.0 - (-2.0 * PI * hz / sample_rate).exp(), y: 0.0 }
    }
    fn lp(&mut self, x: f32) -> f32 {
        self.y += self.a * (x - self.y);
        self.y
    }
    fn hp(&mut self, x: f32) -> f32 {
        x - self.lp(x)
    }
}

/// Instant attack, exponential release.
struct Envelope {
    release: f32,
    y: f32,
}

impl Envelope {
    fn new(release_secs: f32, sample_rate: f32) -> Self {
        Self { release: (-1.0 / (release_secs * sample_rate)).exp(), y: 0.0 }
    }
    fn run(&mut self, x: f32) -> f32 {
        self.y = x.abs().max(self.y * self.release);
        self.y
    }
}

/// Voice band: two high-pass poles, two low-pass poles, then an envelope.
struct Voice {
    poles: [OnePole; 4],
    env: Envelope,
}

impl Voice {
    fn new(sample_rate: f32) -> Self {
        let hp = OnePole::new(VOICE_LO_HZ, sample_rate);
        let lp = OnePole::new(VOICE_HI_HZ.min(sample_rate * 0.45), sample_rate);
        Self { poles: [hp, hp, lp, lp], env: Envelope::new(0.04, sample_rate) }
    }
    fn run(&mut self, x: f32) -> f32 {
        let [a, b, c, d] = &mut self.poles;
        self.env.run(d.lp(c.lp(b.hp(a.hp(x)))))
    }
}

pub struct Detector {
    hop: usize,
    n: usize,
    kick_poles: [OnePole; 2],
    kick_env: Envelope,
    mid: Voice,
    side: Voice,
    loud: Envelope,
    kick_avg: f32,
    kick_peak: f32,
    kick: f32,
    syllable: f32,
    voice_floor: f32,
    voice_peak: f32,
    vocal: f32,
}

impl Detector {
    pub fn new(sample_rate: f32) -> Self {
        let lp = OnePole::new(KICK_HZ, sample_rate);
        Self {
            hop: ((sample_rate * HOP_SECS) as usize).max(1),
            n: 0,
            kick_poles: [lp, lp],
            kick_env: Envelope::new(0.05, sample_rate),
            mid: Voice::new(sample_rate),
            side: Voice::new(sample_rate),
            loud: Envelope::new(3.0, sample_rate),
            kick_avg: 0.0,
            kick_peak: 0.002,
            kick: 0.0,
            syllable: 0.0,
            voice_floor: 0.0,
            voice_peak: 0.003,
            vocal: 0.0,
        }
    }

    /// Feed interleaved samples. Channels 0/1 are left/right; mono counts as centre.
    pub fn feed(&mut self, samples: impl Iterator<Item = f32>, channels: usize) {
        let channels = channels.max(1);
        let (mut l, mut r, mut i) = (0.0f32, 0.0f32, 0usize);
        for s in samples {
            match i {
                0 => l = s,
                1 => r = s,
                _ => {}
            }
            i += 1;
            if i < channels {
                continue;
            }
            i = 0;
            if channels == 1 {
                r = l;
            }
            self.frame((l + r) * 0.5, (l - r) * 0.5);
        }
    }

    fn frame(&mut self, mid: f32, side: f32) {
        let [a, b] = &mut self.kick_poles;
        let low = self.kick_env.run(b.lp(a.lp(mid)));
        let center = (self.mid.run(mid) - self.side.run(side)).max(0.0);
        let loud = self.loud.run(mid.abs().max(side.abs()));
        self.n += 1;
        if self.n >= self.hop {
            self.n = 0;
            self.step(low, center, loud);
        }
    }

    /// One hop. `loud` is the track's recent peak: auto-gain never boosts
    /// either level beyond a share of it, so leftovers of other parts stay quiet.
    fn step(&mut self, low: f32, center: f32, loud: f32) {
        // Kick: how far the low end just jumped above where it has been.
        let rise = (low - self.kick_avg).max(0.0);
        self.kick_avg += (low - self.kick_avg) * KICK_AVG;
        self.kick_peak = rise.max(self.kick_peak * PEAK_DECAY).max(0.002).max(loud * 0.1);
        let hit = ((rise / self.kick_peak - 0.25) / 0.75).clamp(0.0, 1.0);
        self.kick = if hit > self.kick { hit } else { self.kick * KICK_RELEASE };

        // Vocal: centre voice band smoothed to syllable speed, above its floor.
        self.syllable += (center - self.syllable) * if center > self.syllable { 0.5 } else { 0.12 };
        if self.syllable < self.voice_floor {
            self.voice_floor = self.syllable;
        } else {
            self.voice_floor += (self.syllable - self.voice_floor) * FLOOR_RISE;
        }
        let above = self.syllable - self.voice_floor;
        self.voice_peak = above.max(self.voice_peak * PEAK_DECAY).max(0.003).max(loud * 0.15);
        let open = ((above / self.voice_peak - 0.2) / 0.8).clamp(0.0, 1.0);
        self.vocal += (open - self.vocal) * if open > self.vocal { 0.5 } else { 0.2 };

        KICK.store(self.kick.to_bits(), Ordering::Relaxed);
        VOCAL.store(self.vocal.to_bits(), Ordering::Relaxed);
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
        let mut last_sent = [-1.0f32; 2];
        let mut last_at = Instant::now();
        loop {
            std::thread::sleep(EMIT_EVERY);
            if !ACTIVE.load(Ordering::Relaxed) {
                continue;
            }
            let mut v = [&KICK, &VOCAL].map(|a| f32::from_bits(a.load(Ordering::Relaxed)));
            // Silence often means no buffers at all; decay instead of freezing.
            if now_ms().saturating_sub(UPDATED_MS.load(Ordering::Relaxed)) > 120 {
                for (x, a) in v.iter_mut().zip([&KICK, &VOCAL]) {
                    *x *= 0.85;
                    if *x < 0.001 {
                        *x = 0.0;
                    }
                    a.store(x.to_bits(), Ordering::Relaxed);
                }
            }
            let moved = v.iter().zip(&last_sent).any(|(a, b)| (a - b).abs() > 0.004);
            if moved || last_at.elapsed() > Duration::from_millis(250) {
                let _ = app.emit("audio", v);
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
        .args(["--raw", "--format=s16le", "--channels=2", "--latency-msec=20", "-d", "@DEFAULT_MONITOR@"])
        .arg(format!("--rate={RATE}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("parec: {e}"))?;
    let mut out = child.stdout.take().ok_or("no stdout")?;
    let mut det = Detector::new(RATE as f32);
    let mut buf = [0u8; 880]; // 220 stereo frames ≈ 20 ms
    ACTIVE.store(true, Ordering::Relaxed);
    loop {
        // Whole buffers only, so left/right never swap mid-stream.
        if out.read_exact(&mut buf).is_err() {
            let _ = child.wait();
            return Err("parec exited".into());
        }
        let samples = buf.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0);
        det.feed(samples, 2);
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn capture() -> Result<(), String> {
    Err("no capture backend for this platform".into())
}
