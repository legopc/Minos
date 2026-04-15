//! ALSA monitor output writer — PFL solo to local soundcard.
#![cfg(feature = "inferno")]

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u32 = 2; // stereo: L=R (mono PFL duplicated to both ears)
const PERIOD_FRAMES: i64 = 256;
const BUFFER_FRAMES: i64 = 1024;
const MAX_FRAMES: usize = 1024;

pub struct MonitorWriter {
    device_name: String,
    tb_output: Arc<std::sync::Mutex<triple_buffer::Output<[f32; MAX_FRAMES]>>>,
    nframes: Arc<AtomicUsize>,
    solo_active: Arc<AtomicBool>,
    pub shutdown: Arc<AtomicBool>,
}

impl MonitorWriter {
    pub fn new(
        device_name: String,
        tb_output: Arc<std::sync::Mutex<triple_buffer::Output<[f32; MAX_FRAMES]>>>,
        nframes: Arc<AtomicUsize>,
        solo_active: Arc<AtomicBool>,
    ) -> Self {
        Self {
            device_name,
            tb_output,
            nframes,
            solo_active,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn run(self) {
        tracing::info!(device = %self.device_name, "monitor ALSA writer starting");

        // Elevate to FIFO 70 (below Dante RT at 90, above normal)
        #[cfg(target_os = "linux")]
        unsafe {
            let param = libc::sched_param { sched_priority: 70 };
            libc::sched_setscheduler(0, libc::SCHED_FIFO, &param);
        }

        loop {
            if self.shutdown.load(Ordering::Relaxed) {
                break;
            }

            match self.open_and_run() {
                Ok(()) => break,
                Err(e) => {
                    tracing::warn!(err = %e, device = %self.device_name, "monitor ALSA error — retrying in 2s");
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }
        tracing::info!("monitor ALSA writer stopped");
    }

    fn open_and_run(&self) -> Result<(), Box<dyn std::error::Error>> {
        use alsa::pcm::{Access, Format, HwParams, PCM};
        use alsa::Direction;

        let pcm = PCM::new(&self.device_name, Direction::Playback, false)
            .map_err(|e| format!("open {}: {}", self.device_name, e))?;

        {
            let hwp = HwParams::any(&pcm)?;
            hwp.set_channels(CHANNELS)?;
            hwp.set_rate(SAMPLE_RATE, alsa::ValueOr::Nearest)?;
            hwp.set_format(Format::s32())?;
            hwp.set_access(Access::RWInterleaved)?;
            hwp.set_period_size_near(PERIOD_FRAMES, alsa::ValueOr::Nearest)?;
            hwp.set_buffer_size_near(BUFFER_FRAMES)?;
            pcm.hw_params(&hwp)?;
        }
        pcm.prepare()?;
        tracing::info!(device = %self.device_name, "monitor ALSA device opened");

        let silence = vec![0i32; PERIOD_FRAMES as usize * CHANNELS as usize];
        let mut write_buf = vec![0i32; MAX_FRAMES * CHANNELS as usize];

        while !self.shutdown.load(Ordering::Relaxed) {
            let active = self.solo_active.load(Ordering::Acquire);

            if active {
                let nf = self.nframes.load(Ordering::Acquire).min(MAX_FRAMES);
                if nf == 0 {
                    self.write_frames(&pcm, &silence)?;
                    continue;
                }
                let src = {
                    let mut tb = self.tb_output.lock().unwrap();
                    *tb.read()
                };
                // Convert f32 → i32 S32_LE, interleaved stereo (L=R mono PFL)
                for i in 0..nf {
                    let s = f32_to_i32_alsa(src[i]);
                    write_buf[i * 2] = s;
                    write_buf[i * 2 + 1] = s;
                }
                self.write_frames(&pcm, &write_buf[..nf * 2])?;
            } else {
                self.write_frames(&pcm, &silence)?;
            }
        }
        Ok(())
    }

    fn write_frames(&self, pcm: &alsa::pcm::PCM, buf: &[i32]) -> Result<(), Box<dyn std::error::Error>> {
        let io = pcm.io_i32()?;
        if let Err(e) = io.writei(buf) {
            // Capture errno before dropping io (which borrows pcm)
            let errno = e.errno() as i32;
            drop(io);
            pcm.recover(errno, true)?;
            pcm.io_i32()?.writei(buf).map(|_| ()).map_err(Into::into)
        } else {
            Ok(())
        }
    }
}

/// Convert f32 [-1.0, 1.0] to S32_LE (scaled to 24-bit range in 32-bit container).
#[inline]
fn f32_to_i32_alsa(s: f32) -> i32 {
    (s.clamp(-1.0, 1.0) * 8_388_607.0) as i32
}

/// Enumerate available ALSA PCM playback devices from /proc/asound/cards.
/// Returns (hw_name, description) pairs plus plughw equivalents.
/// Does NOT shell out to aplay (not installed on dante-doos).
pub fn enumerate_devices() -> Vec<(String, String)> {
    let mut devices = Vec::new();
    if let Ok(content) = std::fs::read_to_string("/proc/asound/cards") {
        for line in content.lines() {
            // Lines like: " 0 [HD_Audio       ]: HDA-Intel - HDA ATI HDMI"
            // or:         " 1 [Generic        ]: HDA-Intel - HD-Audio Generic"
            let trimmed = line.trim_start();
            if let Some(first_char) = trimmed.chars().next() {
                if first_char.is_ascii_digit() {
                    let card_num: usize = first_char.to_digit(10).unwrap_or(0) as usize;
                    let desc = trimmed
                        .split("]: ")
                        .nth(1)
                        .unwrap_or("Unknown")
                        .trim()
                        .to_string();
                    devices.push((format!("hw:{},0", card_num), desc.clone()));
                    devices.push((format!("plughw:{},0", card_num), format!("{} (plug)", desc)));
                }
            }
        }
    }
    devices
}
