// S7 s7-test-dsp-unit — DSP unit tests.
//
// Known-answer tests. Run: `cargo test -p patchbox-core`.
//
// Targets:
//   - Biquad impulse response matches reference (peaking, lowshelf, highshelf)
//   - Compressor gain reduction at known input level equals -(over-threshold * (1 - 1/ratio))
//   - AFS detector triggers on 1 kHz sine, ignores white noise at same RMS
//   - DEQ band only engages above threshold RMS

#[cfg(test)]
mod tests {
    #[test]
    fn placeholder() {
        // TODO: replace with real DSP assertions.
        assert!(true);
    }
}
