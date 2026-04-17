# Troubleshooting

## Common Issues

### HTTP 401 Unauthorized (API/UI)

**Symptom**: Web UI login fails; API calls return 401.

**Cause**: Missing or invalid JWT token.

**Solution**:
- Ensure you are logged in (refresh the login page).
- Check browser console for error messages.
- Verify the server is running: `systemctl status patchbox`.

### Service Won't Start

**Symptom**: `systemctl start patchbox` fails; status shows `failed` or `inactive`.

**Cause**: Config error, port already in use, or missing Dante driver.

**Solution**:
1. Check logs: `journalctl -u patchbox -n 50`
2. Look for error messages (e.g., "port 9191 already in use").
3. Verify `/etc/patchbox/config.toml` is valid TOML and contains required fields.
4. Ensure Dante network driver is installed: `lsmod | grep dante`.

### Dante Device Not Appearing in Controller

**Symptom**: Device doesn't show in Dante Controller even after boot.

**Cause**: Wrong network interface, Dante driver not loaded, or network issues.

**Solution**:
1. Verify `dante_nic` in config matches your Dante-capable interface: `ip link show`.
2. Check for Dante driver: `lsmod | grep dante` or `dmesg | grep -i dante`.
3. Verify network connectivity: `ping <dante-gateway>`.
4. Restart the Dante interface: `sudo systemctl restart dante-nic` (if available).

### Audio Dropouts or Clicks

**Symptom**: Periodic pops, clicks, or audio gaps.

**Cause**: Buffer underruns (RX jitter buffer too shallow) or system load.

**Solution**:
1. Increase `rx_jitter_samples` in config.toml: try 192 (4 ms) instead of default 48 (1 ms).
2. Increase `lead_samples` if clicks persist: try 96 or 192.
3. Check system load: `top` or `htop`; reduce other processes if CPU is > 70%.
4. Verify network is not congested; use `iperf` if available.

### High PTP Offset

**Symptom**: System tab shows PTP offset > 1 µs; System health tab shows "PTP Not Synced".

**Cause**: Network congestion, poor cable quality, or PTP master clock issue.

**Solution**:
1. Check network cable quality (try a known-good cable).
2. Reduce network congestion (disable other heavy traffic on the Dante network).
3. Verify PTP master (Dante Controller or network switch) is reachable: `ping <ptp-master>`.
4. Check `dante_clock_path` in config points to the correct statime socket.

### Service Crashes Unexpectedly

**Symptom**: `systemctl status patchbox` shows `failed`; random crashes during operation.

**Cause**: Unhandled panic in the backend, resource exhaustion, or audio engine failure.

**Solution**:
1. Check full error logs: `journalctl -u patchbox -n 200 --no-pager`.
2. Look for panic messages or "Out of memory" errors.
3. Enable debug logging (if available) by modifying systemd service file or config.
4. Report the crash and logs to the development team.

## Getting Help

- Check logs: `journalctl -u patchbox -f` (follow in real-time).
- Review `/etc/patchbox/config.toml` for typos or invalid values.
- Test basic network: `ping <dante-network-gateway>`, `iperf` for bandwidth.
- Consult the [API Reference](../api/index.md) or [Configuration](../config/index.md) sections for specific parameter details.
