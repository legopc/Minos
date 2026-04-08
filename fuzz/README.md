# Fuzz Testing (T-04)

Targets in `fuzz_targets/`:
- `fuzz_scene_name` — property-tests `sanitise_name()` for path traversal, empty, oversized
- `fuzz_api_json` — property-tests JSON request body parsing never panics

## Requirements
- Rust nightly: `rustup toolchain install nightly`
- clang/libfuzzer: `apt install clang`

## Running
```bash
# Run for 60 seconds
cargo +nightly fuzz run fuzz_scene_name -- -max_total_time=60
cargo +nightly fuzz run fuzz_api_json   -- -max_total_time=60

# Build only
cargo +nightly fuzz build
```

## CI
Add to `.github/workflows/ci.yml` when a nightly + clang runner is available.
