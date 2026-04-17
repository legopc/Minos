Fuzzing (`cargo-fuzz`)

Setup
- Install cargo-fuzz (once): `cargo install cargo-fuzz`
- Install nightly toolchain (once): `rustup toolchain install nightly`

Run (from repo root)
- `./scripts/fuzz.sh`

Manual run examples
- `cd crates/patchbox-core`
- `cargo +nightly fuzz run config_from_json --features fuzzing`
- `cargo +nightly fuzz run dsp_block_json --features fuzzing`
- `cargo +nightly fuzz run matrix_json --features fuzzing`

Type-check only (no nightly/libFuzzer/C++ toolchain)
- `cargo check --manifest-path crates/patchbox-core/fuzz/Cargo.toml`
