//! DSP performance metrics — CPU usage tracking with EWMA smoothing.

use std::sync::atomic::{AtomicU32, Ordering};

/// DSP metrics aggregated per audio block.
/// CPU usage is stored as a percentage (0-100) in fixed-point u16 format (u16 * 100 ≡ percentage).
/// Relaxed-ordering atomics: advisory metrics, not consistency-critical.
#[derive(Debug)]
pub struct DspMetrics {
    /// Instantaneous CPU usage percentage (0-100), stored as u16 * 100 to preserve 0.01% precision.
    cpu_percent_instant_x100: AtomicU32,
    /// 1-second EWMA smoothed CPU usage percentage (0-100), stored as u16 * 100.
    cpu_percent_avg_x100: AtomicU32,
    /// Total xruns (buffer underruns) since startup.
    xruns: AtomicU32,
}

impl DspMetrics {
    /// Create a new DspMetrics instance.
    pub fn new() -> Self {
        Self {
            cpu_percent_instant_x100: AtomicU32::new(0),
            cpu_percent_avg_x100: AtomicU32::new(0),
            xruns: AtomicU32::new(0),
        }
    }

    /// Update CPU usage metrics after processing one audio block.
    ///
    /// # Arguments
    /// * `block_duration_us` — wall-clock time spent processing the block, in microseconds
    /// * `budget_us` — available processing budget (block_size_samples / sample_rate * 1_000_000)
    ///
    /// # Note
    /// Call this once per audio block from the RT processing loop.
    /// Values are stored in fixed-point format (x100) for atomic u32 storage.
    pub fn update_block_cpu(&self, block_duration_us: u32, budget_us: u32) {
        let cpu_percent = if budget_us > 0 {
            let ratio = (block_duration_us as f64) / (budget_us as f64);
            let percent = (ratio * 100.0).min(100.0).max(0.0);
            (percent * 100.0) as u32 // Store as x100 for 0.01% precision
        } else {
            0
        };

        // Update instantaneous value
        self.cpu_percent_instant_x100
            .store(cpu_percent, Ordering::Relaxed);

        // Apply EWMA smoothing (window ~10ms @ 48kHz, practical for metering)
        self.apply_ewma_smoothing(cpu_percent);
    }

    /// Apply EWMA smoothing with ~10ms time constant @ 48 kHz.
    /// α = 1/480 ≈ 0.00208, giving ~480-block integration window.
    /// This smooths out per-block jitter while remaining responsive to load changes.
    fn apply_ewma_smoothing(&self, new_value: u32) {
        const ALPHA_NUMERATOR: u32 = 1;
        const ALPHA_DENOMINATOR: u32 = 480;

        let current = self.cpu_percent_avg_x100.load(Ordering::Relaxed);
        let current_f64 = current as f64;
        let new_f64 = new_value as f64;

        // EWMA: new_avg = current + α * (new - current)
        let alpha = (ALPHA_NUMERATOR as f64) / (ALPHA_DENOMINATOR as f64);
        let next = current_f64 + alpha * (new_f64 - current_f64);
        let next_u32 = next.round() as u32;

        self.cpu_percent_avg_x100.store(next_u32, Ordering::Relaxed);
    }

    /// Increment xrun counter.
    pub fn increment_xruns(&self) {
        self.xruns.fetch_add(1, Ordering::Relaxed);
    }

    /// Get instantaneous CPU usage as a percentage (0.0–100.0).
    pub fn cpu_percent_instant(&self) -> f32 {
        let x100 = self.cpu_percent_instant_x100.load(Ordering::Relaxed);
        (x100 as f32) / 100.0
    }

    /// Get smoothed CPU usage as a percentage (0.0–100.0).
    pub fn cpu_percent_avg(&self) -> f32 {
        let x100 = self.cpu_percent_avg_x100.load(Ordering::Relaxed);
        (x100 as f32) / 100.0
    }

    /// Get total xruns.
    pub fn xruns(&self) -> u64 {
        self.xruns.load(Ordering::Relaxed) as u64
    }

    /// Determine health status based on average CPU usage.
    /// - healthy: < 70%
    /// - degraded: 70–90%
    /// - unhealthy: > 90%
    pub fn status(&self) -> DspStatus {
        let avg = self.cpu_percent_avg();
        if avg < 70.0 {
            DspStatus::Healthy
        } else if avg < 90.0 {
            DspStatus::Degraded
        } else {
            DspStatus::Unhealthy
        }
    }
}

impl Default for DspMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// DSP subsystem health status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DspStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

impl DspStatus {
    /// Return as a string for serialization.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Unhealthy => "unhealthy",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cpu_percent_storage_and_retrieval() {
        let metrics = DspMetrics::new();
        let budget_us = 1000; // 1ms budget

        // Test 50% CPU load
        metrics.update_block_cpu(500, budget_us);
        assert!((metrics.cpu_percent_instant() - 50.0).abs() < 0.1);

        // Test 100% CPU load
        metrics.update_block_cpu(1000, budget_us);
        assert!((metrics.cpu_percent_instant() - 100.0).abs() < 0.1);

        // Test 0% CPU load
        metrics.update_block_cpu(0, budget_us);
        assert!((metrics.cpu_percent_instant() - 0.0).abs() < 0.1);
    }

    #[test]
    fn test_ewma_smoothing_convergence() {
        let metrics = DspMetrics::new();
        let budget_us = 1000;

        // Apply 50% load repeatedly. With α=1/480, convergence takes longer.
        // After ~1000 samples, should be significantly higher.
        for _ in 0..1000 {
            metrics.update_block_cpu(500, budget_us);
        }

        let avg = metrics.cpu_percent_avg();
        // After 1000 samples at 50%, should be significantly higher but not fully converged
        assert!(avg > 20.0 && avg < 65.0, "Expected 20-65%, got {}", avg);
    }

    #[test]
    fn test_ewma_smoothing_startup() {
        let metrics = DspMetrics::new();
        let budget_us = 1000;

        // First update at 100%
        metrics.update_block_cpu(1000, budget_us);
        let after_first = metrics.cpu_percent_avg();
        assert!(
            after_first > 0.0 && after_first < 1.5,
            "After 1 sample at 100%, avg should be ~0.2%, got {}",
            after_first
        );

        // After 10 samples, should be higher
        for _ in 0..9 {
            metrics.update_block_cpu(1000, budget_us);
        }
        let after_ten = metrics.cpu_percent_avg();
        assert!(
            after_first < after_ten,
            "EWMA should increase with each 100% sample, {} < {}",
            after_first,
            after_ten
        );
    }

    #[test]
    fn test_status_determination() {
        let metrics = DspMetrics::new();
        let budget_us = 1000;

        // Set avg to ~30% (multiple low samples)
        for _ in 0..100 {
            metrics.update_block_cpu(300, budget_us);
        }
        assert_eq!(metrics.status(), DspStatus::Healthy);

        // Set avg to ~75% — need many samples to converge
        for _ in 0..2000 {
            metrics.update_block_cpu(750, budget_us);
        }
        assert_eq!(metrics.status(), DspStatus::Degraded);

        // Set avg to ~95%
        for _ in 0..2000 {
            metrics.update_block_cpu(950, budget_us);
        }
        assert_eq!(metrics.status(), DspStatus::Unhealthy);
    }

    #[test]
    fn test_xrun_counter() {
        let metrics = DspMetrics::new();
        assert_eq!(metrics.xruns(), 0);

        metrics.increment_xruns();
        assert_eq!(metrics.xruns(), 1);

        for _ in 0..9 {
            metrics.increment_xruns();
        }
        assert_eq!(metrics.xruns(), 10);
    }

    #[test]
    fn test_cpu_clipping_at_100_percent() {
        let metrics = DspMetrics::new();
        let budget_us = 1000;

        // Process longer than budget (should clip to 100%)
        metrics.update_block_cpu(5000, budget_us);
        assert!((metrics.cpu_percent_instant() - 100.0).abs() < 0.1);
    }

    #[test]
    fn test_zero_budget_handling() {
        let metrics = DspMetrics::new();
        metrics.update_block_cpu(100, 0);
        assert_eq!(metrics.cpu_percent_instant(), 0.0);
    }
}
