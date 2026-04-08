//! Sample format conversion between inferno_aoip (i32, 24-bit PCM) and
//! patchbox-core DSP (f32, -1.0..1.0).
//!
//! Dante / inferno_aoip uses `Sample = i32` with the audio value packed in
//! the lower 24 bits (signed, two's complement).

/// Normalise a 24-bit-packed i32 sample to f32 in −1.0 .. +1.0.
#[inline(always)]
pub fn i32_to_f32(s: i32) -> f32 {
    s as f32 / (1i32 << 23) as f32
}

/// Denormalise an f32 sample (−1.0 .. +1.0) to a 24-bit-packed i32.
/// Clamps to avoid wrap-around on values outside range.
#[inline(always)]
pub fn f32_to_i32(s: f32) -> i32 {
    let scale = (1i32 << 23) as f32;
    let clamped = s.clamp(-1.0, 1.0);
    (clamped * scale) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        for val in [-1.0f32, -0.5, 0.0, 0.5, 1.0 - f32::EPSILON] {
            let rt = i32_to_f32(f32_to_i32(val));
            assert!((rt - val).abs() < 1e-6, "round-trip failed for {val}: got {rt}");
        }
    }
}
