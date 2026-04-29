# Building patchbox for Dante/Inferno

## Correct Build Command

```bash
cargo build --release --features patchbox/inferno
```

**IMPORTANT:** Use `patchbox/inferno` for deploy builds.

The `patchbox/Cargo.toml` defines:
The `patchbox` crate's `inferno` feature enables the real Dante dependency feature internally.

This means `patchbox/inferno` is a feature proxy that enables both the local inferno feature AND the dependency's inferno feature.

## Previous Bug

Building only the Dante dependency feature did NOT enable the local `patchbox` binary `inferno` feature, causing `main.rs` to spawn a background task generating sine wave test data that overwrote real audio metering values in `m.rx_rms` and `m.tx_rms`. This manifested as VU meters showing sine wave movements instead of real Dante audio levels.

## Deployment

1. Build on the target machine or copy binary to target
2. Stop service: `sudo systemctl stop patchbox`
3. Copy new binary to `/home/legopc/dante-patchbox/target/release/patchbox`
4. Start service: `sudo systemctl start patchbox
