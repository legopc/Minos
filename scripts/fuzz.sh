#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

command -v cargo-fuzz >/dev/null 2>&1 || {
  echo "cargo-fuzz not found. Install with: cargo install cargo-fuzz" >&2
  echo "Type-check only: cargo check --manifest-path crates/patchbox-core/fuzz/Cargo.toml" >&2
  exit 2
}

cd "$repo_root/crates/patchbox-core"

# Requires nightly (cargo-fuzz uses -Zsanitizer=fuzzer) and a C++ toolchain (clang++/g++).

echo "Run one of:"
echo "  cargo +nightly fuzz run config_from_json --features fuzzing"
echo "  cargo +nightly fuzz run dsp_block_json --features fuzzing"
echo "  cargo +nightly fuzz run matrix_json --features fuzzing"
