# Install & Deploy

## Prerequisites

- Linux host with Dante AES67 network driver (or Dante VM/Linux driver).
- Rust toolchain (1.70+) for building from source.
- Gigabit Ethernet NIC dedicated to Dante.
- systemd for service management (optional but recommended).

## Build

```bash
cd /home/legopc/dante-patchbox
cargo build --release --features inferno
```

Output binary: `target/release/patchbox`

## Installation

1. **Copy binary to system location**:
   ```bash
   sudo cp target/release/patchbox /opt/patchbox/patchbox
   sudo chmod 755 /opt/patchbox/patchbox
   ```

2. **Create config directory**:
   ```bash
   sudo mkdir -p /etc/patchbox
   ```

3. **Copy config.toml**:
   ```bash
   sudo cp config.toml.example /etc/patchbox/config.toml
   sudo chown root:root /etc/patchbox/config.toml
   ```

4. **Edit config.toml** for your environment:
   - Set `dante_nic` to the correct network interface.
   - Adjust `rx_channels` and `tx_channels` for your setup.
   - Configure zone and source names.

5. **Install systemd service** (if using):
   ```bash
   sudo cp patchbox.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

6. **Start the service**:
   ```bash
   sudo systemctl start patchbox
   ```

## Verification

Check that the service is running:

```bash
systemctl status patchbox
```

Access the web UI:

```
http://localhost:9191
```

You should see the mixer UI with inputs/outputs and routing matrix. Check the System tab for Dante device status and PTP sync offset.

## Logs

Follow service logs in real-time:

```bash
journalctl -u patchbox -f
```

Common startup messages: Dante device initialization, PTP clock sync, config loading.
