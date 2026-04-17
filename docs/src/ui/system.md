# System Tab

The **System** tab displays system information, health status, and diagnostics.

## Information Displayed

- **Version**: Minos build version and commit hash.
- **Dante Status**: Dante device name, NIC, subscription state (Device Online, Learning, etc.).
- **PTP Sync**: Statime PTP clock offset (in nanoseconds, when available). Low offset = tight sync.
- **Audio Buffer Health**: RX jitter buffer depth, TX lead samples, and typical audio latency.
- **Uptime**: Server uptime in hours/days.
- **WebSocket**: Connection status to the backend (connected/disconnected).
- **Config File**: Path to the active config.toml and last-modified time.

## Diagnostics & Actions

- **Reload Config**: Restart the Dante stream and reload config.toml without server restart.
- **Clear Cache**: Clear any cached state (if applicable).
- **Help & Shortcuts**: View keyboard shortcuts for the UI (Shift+?, or button in System tab).

## Health Checks

Minos performs periodic health checks on:

- Dante network connectivity (heartbeat).
- PTP synchronization offset.
- Audio engine load (CPU utilization).
- RX/TX buffer conditions.

If issues are detected, a warning badge appears on the System tab; check the system log (journalctl) for details.
