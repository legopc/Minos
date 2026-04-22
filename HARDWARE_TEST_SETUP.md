# Hardware Test Setup

This document covers what you need to test Minos on real Dante hardware.

## Machine Setup

### 1. Install Arch Linux
Standard Arch install with:
- `base`, `base-devel`
- Network connected to Dante VLAN (192.168.1.0/24)

### 2. Clone and Build
```bash
git clone https://github.com/legopc/dante-patchbox.git
cd dante-patchbox
sudo bash scripts/install-arch.sh
```

The install script handles:
- Rust toolchain
- System packages (clang, lld, pkg-config, openssl, pam, rsync)
- Building with `--features patchbox-dante/inferno` (real Dante audio)
- Setting capabilities (`cap_net_raw`, `cap_sys_nice`)
- Systemd services (patchbox + statime)

### 3. Configure

Edit `/etc/patchbox/config.toml`:
```toml
dante_name = "patchbox-test"   # Name on Dante network
dante_nic = "eth0"            # Your Dante interface
rx_channels = 8               # Match your RX subscriptions
tx_channels = 8               # Match your TX outputs
```

Edit `/etc/statime/statime.toml`:
```toml
[[port]]
interface = "eth0"           # Must match dante_nic above
```

### 4. Identify Dante Interface
```bash
ip link show
# Look for your Dante-connected NIC (e.g., eth0, enp1s0)
```

### 5. Start Services
```bash
sudo systemctl restart statime
sudo systemctl restart patchbox
```

### 6. Verify
```bash
# Check health
curl http://localhost:9191/api/v1/health

# Check Dante devices visible
# In Dante Controller, you should see "patchbox-test"

# Web UI
http://<machine-ip>:9191
```

## Expected Dante Behavior

With 8x8 config:
- TX 1-2: Main Bar L/R (subscribed by MXWANI8 Zone 1)
- TX 3-4: Terrace L/R (subscribed by MXWANI8 Zone 2)
- TX 5-6: Stage L/R (subscribed by Shure MXWANI8 Zone 3)
- TX 7-8: Boiler Room + Office (spares)

## Troubleshooting

### Dante device not visible
- Check `dante_nic` matches your Dante interface
- Check statime is running: `systemctl status statime`
- Verify PTP: `journalctl -u statime -f`

### Audio glitches
- Increase `lead_samples` to 128 or 192
- Check network load
- Verify PTP lock: `journalctl -u statime | grep -i lock`

### Build fails
- Ensure `clang` is installed
- `pacman -S clang lld`
- Then re-run build

## Test Config

For quick iterative testing, use the included `dev-config.toml`:
```bash
sudo cp /etc/patchbox/config.toml /etc/patchbox/config.toml.backup
sudo cp dante-patchbox/dev-config.toml /etc/patchbox/config.toml
sudo systemctl restart patchbox
```
