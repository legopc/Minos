//! RT-safe circular buffer delay line.
//! No allocations, no locks — safe to call from the audio callback.

use crate::config::DelayConfig;

/// Maximum delay buffer size: 500ms @ 48kHz = 24000 samples.
const MAX_DELAY_SAMPLES: usize = 24_000;

/// Circular buffer delay line.
/// Pre-allocates the entire buffer at construction; no allocations in process_block.
pub struct DelayLine {
    /// Pre-allocated circular buffer.
    buffer: [f32; MAX_DELAY_SAMPLES],
    /// Current write position in the buffer.
    write_pos: usize,
    /// Number of samples to delay (computed from delay_ms and sample_rate).
    delay_samples: usize,
    /// Whether the delay is enabled.
    enabled: bool,
    /// Shadow of last delay_ms for change detection.
    last_delay_ms: f32,
    /// Shadow of last enabled state for change detection.
    last_enabled: bool,
}

impl DelayLine {
    /// Construct a new, zeroed delay line.
    pub fn new() -> Self {
        Self {
            buffer: [0.0; MAX_DELAY_SAMPLES],
            write_pos: 0,
            delay_samples: 0,
            enabled: false,
            last_delay_ms: f32::NAN,
            last_enabled: false,
        }
    }

    /// Sync the delay line from config. Flush buffer if delay changes or on disable.
    /// RT-safe: pure arithmetic, no allocation.
    pub fn sync(&mut self, cfg: &DelayConfig, sample_rate: f32) {
        // Clamp delay_ms to [0, 500]
        let delay_ms = cfg.delay_ms.clamp(0.0, 500.0);

        // Compute delay in samples: delay_ms * 0.001 * sample_rate
        let delay_samples_f = delay_ms * 0.001 * sample_rate;
        let mut delay_samples = delay_samples_f.round() as usize;

        // Clamp to [0, MAX_DELAY_SAMPLES - 1]
        if delay_samples >= MAX_DELAY_SAMPLES {
            delay_samples = MAX_DELAY_SAMPLES - 1;
        }

        // Detect changes: if delay_ms or enabled state changed, flush the buffer
        let delay_changed = (delay_ms - self.last_delay_ms).abs() > 0.001;
        let enabled_changed = cfg.enabled != self.last_enabled;

        if delay_changed || enabled_changed {
            // Zero the buffer to avoid audio glitches
            for i in 0..MAX_DELAY_SAMPLES {
                self.buffer[i] = 0.0;
            }
            self.write_pos = 0;
        }

        // Update state and shadow
        self.enabled = cfg.enabled;
        self.delay_samples = delay_samples;
        self.last_delay_ms = delay_ms;
        self.last_enabled = cfg.enabled;
    }

    /// Process a block of audio in-place. RT-safe: no allocation.
    /// If disabled or delay_samples is 0, the input passes through unchanged.
    pub fn process_block(&mut self, buf: &mut [f32]) {
        if !self.enabled || self.delay_samples == 0 {
            // Pass through unchanged
            return;
        }

        for sample in buf.iter_mut() {
            // Read from delay_samples samples back
            let read_pos =
                (self.write_pos + MAX_DELAY_SAMPLES - self.delay_samples) % MAX_DELAY_SAMPLES;
            let delayed = self.buffer[read_pos];

            // Write input to buffer
            self.buffer[self.write_pos] = *sample;

            // Output the delayed sample
            *sample = delayed;

            // Advance write position
            self.write_pos = (self.write_pos + 1) % MAX_DELAY_SAMPLES;
        }
    }
}

impl Default for DelayLine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_delay_passes_unchanged() {
        let mut delay = DelayLine::new();
        let cfg = DelayConfig {
            enabled: false,
            delay_ms: 100.0,
        };
        delay.sync(&cfg, 48_000.0);

        let mut buf = [1.0, 2.0, 3.0, 4.0, 5.0];
        let orig = buf;
        delay.process_block(&mut buf);

        assert_eq!(buf, orig, "disabled delay should pass signal unchanged");
    }

    #[test]
    fn zero_delay_passes_unchanged() {
        let mut delay = DelayLine::new();
        let cfg = DelayConfig {
            enabled: true,
            delay_ms: 0.0,
        };
        delay.sync(&cfg, 48_000.0);

        let mut buf = [1.0, 2.0, 3.0, 4.0, 5.0];
        let orig = buf;
        delay.process_block(&mut buf);

        assert_eq!(buf, orig, "zero delay should pass signal unchanged");
    }

    #[test]
    fn delay_shifts_signal_by_correct_samples() {
        let mut delay = DelayLine::new();
        let cfg = DelayConfig {
            enabled: true,
            delay_ms: 1.0,
        };
        delay.sync(&cfg, 48_000.0);

        // 1.0 ms @ 48kHz = 48 samples
        assert_eq!(delay.delay_samples, 48);

        // Create input: 96 samples with an impulse at sample 0
        let mut buf = [0.0; 96];
        buf[0] = 1.0;

        delay.process_block(&mut buf);

        // After processing, the impulse should have shifted by 48 samples
        // buf[0..48] should be 0 (reading pre-delay buffer, which was 0)
        // buf[48] should be 1.0 (the impulse shifted)
        // buf[49..96] should be 0
        for (i, &sample) in buf.iter().enumerate().take(48) {
            assert!(
                (sample - 0.0).abs() < 1e-6,
                "buf[{}] should be 0.0, got {}",
                i,
                sample
            );
        }
        assert!(
            (buf[48] - 1.0).abs() < 1e-6,
            "buf[48] should be 1.0 (delayed impulse), got {}",
            buf[48]
        );
        for (i, &sample) in buf.iter().enumerate().skip(49) {
            assert!(
                (sample - 0.0).abs() < 1e-6,
                "buf[{}] should be 0.0, got {}",
                i,
                sample
            );
        }
    }

    #[test]
    fn delay_change_flushes_buffer() {
        let mut delay = DelayLine::new();
        let cfg1 = DelayConfig {
            enabled: true,
            delay_ms: 1.0,
        };
        delay.sync(&cfg1, 48_000.0);

        // Fill the buffer with non-zero data
        let mut fill_buf = [0.5; 100];
        delay.process_block(&mut fill_buf);

        // Verify buffer contains non-zero data (not all zeros after fill)
        // The buffer should have written 100 samples of 0.5
        // and output some zeros from pre-delay buffer area

        // Now change delay_ms — this should flush the buffer
        let cfg2 = DelayConfig {
            enabled: true,
            delay_ms: 2.0,
        };
        delay.sync(&cfg2, 48_000.0);

        // Process a block of zeros; output should be clean (all zeros)
        // because the buffer was flushed
        let mut test_buf = [0.0; 50];
        delay.process_block(&mut test_buf);

        // After flushing and processing zeros, output should be zeros
        for (i, &sample) in test_buf.iter().enumerate() {
            assert!(
                (sample - 0.0).abs() < 1e-6,
                "test_buf[{}] should be 0.0 (clean after flush), got {}",
                i,
                sample
            );
        }
    }

    #[test]
    fn delay_clamped_to_500ms() {
        let mut delay = DelayLine::new();
        let cfg = DelayConfig {
            enabled: true,
            delay_ms: 1000.0, // Exceeds 500ms
        };
        delay.sync(&cfg, 48_000.0);

        // delay_samples should be clamped to MAX_DELAY_SAMPLES - 1
        assert_eq!(
            delay.delay_samples,
            MAX_DELAY_SAMPLES - 1,
            "delay should be clamped to max"
        );
    }

    #[test]
    fn buffer_pre_allocated_no_panic() {
        // This test verifies the buffer is pre-allocated and doesn't panic
        // when processing large blocks.
        let mut delay = DelayLine::new();
        let cfg = DelayConfig {
            enabled: true,
            delay_ms: 100.0,
        };
        delay.sync(&cfg, 48_000.0);

        // Process maximum reasonable block size
        let mut buf = vec![0.1; 4096];
        delay.process_block(&mut buf);
        // If we got here without panicking, the buffer was pre-allocated
        assert_eq!(buf.len(), 4096);
    }
}
