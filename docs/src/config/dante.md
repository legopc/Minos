# Dante Device Setup

Minos appears on the network as a **Dante virtual device** with a configurable name and network interface.

## Configuration

In `config.toml`, set:

```toml
dante_name = "patchbox"          # Device name visible in Dante Controller
dante_nic = "eth0"               # Network interface (e.g., eth0, ens0)
dante_clock_path = "/tmp/ptp-usrvclock"  # PTP clock socket (default)
```

The `dante_name` is the identifier you'll see in Dante Controller when adding Minos to your network.

## Dante Network Requirements

- **Gigabit Ethernet**: Dante requires a dedicated or isolated high-speed network.
- **PTP Synchronization**: Minos uses statime (an open-source PTP client) for clock sync to the Dante network master. Confirm PTP offset in System tab (typically < 1 µs on a clean LAN).
- **Dante Subscription**: After Minos boots, it automatically subscribes to the Dante network. Use Dante Controller to route Dante flows to/from this device.

## Optional PTP Socket

If you have a statime observation socket, configure:

```toml
statime_observation_path = "/run/statime/observation.sock"
```

This allows Minos to report real PTP offset in the health endpoint.

## Troubleshooting

- **Device not appearing in Dante Controller**: Check network cable, verify `dante_nic` is correct, check firewall/multicast settings.
- **PTP offset high (> 1 ms)**: Check network congestion, cable quality, or PTP master clock.
- **Audio dropouts**: Increase `rx_jitter_samples` in config (default 48; try 192 for 4 ms depth).

See the Dante tab for the admin troubleshooting view: Dante/PTP health, route tracing, recent Dante events, and recovery actions. The System tab still shows broader device status.
