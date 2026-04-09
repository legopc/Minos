# dante-patchbox

A Dante AoIP software patchbay and DSP mixer for venue audio systems.

> **v2 — rewrite from first principles**
> v1 is archived on the `v1-archive` branch. This is a clean redesign
> based on real requirements. See `docs/PROJECT.md` for the full design.

## What it does

Routes Dante audio sources through a configurable NxM matrix with per-input
gain staging, per-output volume control, and DSP. A single binary serves the
web UI, REST API, and WebSocket metering.

## Status

🚧 **Phase 0 — in progress** — routing matrix scaffold, Dante integration pending

## Quick start

```bash
cargo build --release
./target/release/patchbox
```

See `docs/PROJECT.md` for architecture and roadmap.
