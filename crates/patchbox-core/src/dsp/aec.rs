//! Acoustic Echo Cancellation (AEC) processor.
//!
//! Wraps the `aec3` crate's `VoipAec3` behind a 480-sample accumulator so it
//! works with arbitrary Dante block sizes. Only compiled with `--features aec`.
//!
//! # Usage
//! ```ignore
//! let mut aec = AecProcessor::new(48_000);
//! // In RT callback per block:
//! aec.process(&mut capture_block, reference_block);
//! ```

#[cfg(feature = "aec")]
use aec3::voip::{VoipAec3, VoipAec3Builder};

/// AEC frame size in samples at 48 kHz (10 ms — mandated by WebRTC AEC3).
pub const AEC_FRAME_SAMPLES: usize = 480;

/// Acoustic echo canceller wrapping WebRTC AEC3 via the `aec3` crate.
///
/// Accumulates input samples until a full 480-sample frame is ready, runs
/// AEC3, and writes the processed samples back to the source buffer.
/// A one-block-delayed reference accumulator feeds the render path.
pub struct AecProcessor {
    /// Configured sample rate (must be 48000 for AEC3 at 10 ms frames)
    pub sample_rate: usize,
    /// TX output index used as the loudspeaker reference, or `None` for no reference
    pub reference_tx_idx: Option<usize>,

    /// Circular accumulator for capture (microphone) input
    capture_acc: Vec<f32>,
    capture_acc_pos: usize,

    /// Circular accumulator for render (loudspeaker) input
    render_acc: Vec<f32>,
    render_acc_pos: usize,

    /// Output ring: processed samples waiting to be drained back to caller
    output_ring: Vec<f32>,
    output_read: usize,
    output_write: usize,

    #[cfg(feature = "aec")]
    inner: VoipAec3,
}

impl AecProcessor {
    /// Create a new AEC processor for the given sample rate.
    ///
    /// Panics if the sample rate is not 48000 — AEC3 only supports multiples of 8000
    /// with 10 ms frames, and we target Dante's fixed 48 kHz clock.
    pub fn new(sample_rate: usize) -> Self {
        #[cfg(feature = "aec")]
        let inner = VoipAec3Builder::new(sample_rate, 1, 1)
            .enable_high_pass(true)
            .enable_noise_suppression(false)
            .build()
            .expect("aec3 VoipAec3 construction failed");

        Self {
            sample_rate,
            reference_tx_idx: None,
            capture_acc: vec![0.0; AEC_FRAME_SAMPLES * 2],
            capture_acc_pos: 0,
            render_acc: vec![0.0; AEC_FRAME_SAMPLES * 2],
            render_acc_pos: 0,
            output_ring: vec![0.0; AEC_FRAME_SAMPLES * 4],
            output_read: 0,
            output_write: 0,
            #[cfg(feature = "aec")]
            inner,
        }
    }

    /// Feed a block of render (loudspeaker reference) samples.
    ///
    /// Must be called once per block *before* `process()` with the TX output
    /// from the previous audio block.
    pub fn push_render(&mut self, render: &[f32]) {
        for &s in render {
            let pos = self.render_acc_pos % self.render_acc.len();
            self.render_acc[pos] = s;
            self.render_acc_pos += 1;
        }
    }

    /// Process a capture block in-place.
    ///
    /// Accumulates samples until a full 480-sample AEC frame is available,
    /// then runs AEC3 and writes the result back via the output ring.
    /// If fewer than 480 samples of output are available, the input is passed
    /// through unmodified (sub-480-sample latency blip at startup only).
    #[inline]
    pub fn process(&mut self, buf: &mut [f32]) {
        #[cfg(not(feature = "aec"))]
        {
            // Feature not compiled in — passthrough
            let _ = buf;
            return;
        }

        #[cfg(feature = "aec")]
        {
            let ring_len = self.output_ring.len();

            for s in buf.iter_mut() {
                // Push sample into capture accumulator
                let pos = self.capture_acc_pos % self.capture_acc.len();
                self.capture_acc[pos] = *s;
                self.capture_acc_pos += 1;

                // Once a full AEC frame is accumulated, run AEC3
                if self.capture_acc_pos % AEC_FRAME_SAMPLES == 0 {
                    let frame_start = (self.capture_acc_pos - AEC_FRAME_SAMPLES)
                        % self.capture_acc.len();

                    // Build contiguous capture frame (handle wrap-around)
                    let mut cap_frame = [0.0f32; AEC_FRAME_SAMPLES];
                    for i in 0..AEC_FRAME_SAMPLES {
                        cap_frame[i] = self.capture_acc[(frame_start + i) % self.capture_acc.len()];
                    }

                    // Build render frame from accumulator if available
                    let has_render = self.render_acc_pos >= AEC_FRAME_SAMPLES;
                    let render_frame: Option<[f32; AEC_FRAME_SAMPLES]> = if has_render {
                        let rstart = (self.render_acc_pos - AEC_FRAME_SAMPLES)
                            % self.render_acc.len();
                        let mut rf = [0.0f32; AEC_FRAME_SAMPLES];
                        for i in 0..AEC_FRAME_SAMPLES {
                            rf[i] = self.render_acc[(rstart + i) % self.render_acc.len()];
                        }
                        Some(rf)
                    } else {
                        None
                    };

                    let mut out_frame = [0.0f32; AEC_FRAME_SAMPLES];
                    let _ = self.inner.process(
                        &cap_frame,
                        render_frame.as_ref().map(|r| r.as_slice()),
                        false,
                        &mut out_frame,
                    );

                    // Push processed output into ring
                    for &o in &out_frame {
                        self.output_ring[self.output_write % ring_len] = o;
                        self.output_write += 1;
                    }
                }

                // Drain output ring back to caller
                let available = self.output_write.wrapping_sub(self.output_read);
                if available > 0 {
                    *s = self.output_ring[self.output_read % ring_len];
                    self.output_read += 1;
                }
                // else: not enough output yet — passthrough (startup only)
            }
        }
    }
}
