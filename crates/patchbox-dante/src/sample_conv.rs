//! Sample format conversion between inferno_aoip (i32, 24-bit PCM) and
//! patchbox-core DSP (f32, -1.0..1.0).
//!
//! Dante / inferno_aoip packs 24-bit audio in the **upper** 24 bits of i32
//! (left-justified, big-endian on the wire).  The wire format is:
//!   S24: [MSB, mid, LSB] of the upper 3 bytes of to_be_bytes()
//!   Reader: ((b[0] as u32) << 24) | ((b[1] as u32) << 16) | ((b[2] as u32) << 8)
//!
//! Therefore the full-scale range is ±2^31 and we normalise by dividing by 2^31.

const SCALE: f32 = 2147483648.0_f32; // 2^31

/// Normalise a left-justified 24-bit-in-i32 sample to f32 in −1.0 .. +1.0.
#[inline(always)]
pub fn i32_to_f32(s: i32) -> f32 {
    s as f32 / SCALE
}

/// Denormalise an f32 sample (−1.0 .. +1.0) to a left-justified 24-bit-in-i32.
/// Clamps to avoid wrap-around; Rust float-to-int casts saturate since 1.45.
#[inline(always)]
pub fn f32_to_i32(s: f32) -> i32 {
    let clamped = s.clamp(-1.0, 1.0);
    // 1.0 * 2^31 overflows i32::MAX — the saturating cast maps it to 0x7FFFFFFF.
    (clamped * SCALE) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        for val in [-1.0f32, -0.5, 0.0, 0.5, 1.0 - f32::EPSILON] {
            let rt = i32_to_f32(f32_to_i32(val));
            assert!(
                (rt - val).abs() < 1e-4,
                "round-trip failed for {val}: got {rt}"
            );
        }
    }

    #[test]
    fn upper_24_bits_encoding() {
        // 0.5 → 0x40000000; upper 3 bytes = [0x40, 0x00, 0x00]
        let enc = f32_to_i32(0.5_f32);
        assert_eq!(
            enc.to_be_bytes()[0..3],
            [0x40, 0x00, 0x00],
            "0.5 not in upper 24 bits"
        );
        // -1.0 → i32::MIN = 0x80000000; upper 3 bytes = [0x80, 0x00, 0x00]
        let enc_neg = f32_to_i32(-1.0_f32);
        assert_eq!(
            enc_neg.to_be_bytes()[0..3],
            [0x80, 0x00, 0x00],
            "-1.0 not in upper 24 bits"
        );
    }
}
