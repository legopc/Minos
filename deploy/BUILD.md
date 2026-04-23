# Building patchbox for Dante/Inferno

## Correct Build Command

```bash
cargo build --release --features patchbox/inferno
```

**IMPORTANT:** Use `patchbox/inferno` NOT `patchbox-dante/inferno`.

The `patchbox/Cargo.toml` defines:
```toml
inferno = ['patchbox-dante/inferno']
```

This means `patchbox/inferno` is a feature proxy that enables both the local inferno feature AND the dependency's inferno feature. Using `--features patchbox-dante/inferno` directly only enables the dependency's feature, leaving the local `#[cfg(not(feature = "inferno"))]` code active, which generates sine wave test data that overwrites real Dante audio metering.

## Previous Bug

Build command `--features patchbox-dante/inferno` did NOT enable the local `inferno` feature, causing `main.rs` to spawn a background task generating sine wave test data that overwrote real audio metering values in `m.rx_rms` and `m.tx_rms`. This manifested as VU meters showing sine wave movements instead of real Dante audio levels.

## Deployment

1. Build on the target machine or copy binary to target
2. Stop service: `sudo systemctl stop patchbox`
3. Copy new binary to `/home/legopc/dante-patchbox/target/release/patchbox`
4. Start service: `sudo systemctl start patchbox
