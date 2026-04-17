#!/usr/bin/env bash
# Regenerate web/src/generated/dsp-defaults.json from Rust DSP defaults.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
cargo run -p patchbox-core --bin gen-dsp-defaults
