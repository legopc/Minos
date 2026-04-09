//! Gain utilities

/// Clamp a dB value to a safe range
pub fn clamp_db(db: f32) -> f32 {
    db.clamp(-60.0, 12.0)
}
