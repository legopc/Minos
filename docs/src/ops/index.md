# Operations

This section covers installation, deployment, upgrades, and troubleshooting.

## Installation & Deployment

- **Binary location**: `/opt/patchbox/patchbox` (after build and install).
- **Config location**: `/etc/patchbox/config.toml` (main configuration file).
- **systemd service**: `patchbox.service` (runs Minos as a system daemon).

## Starting the Service

```bash
systemctl start patchbox
systemctl enable patchbox  # Auto-start on boot
```

## Checking Status

```bash
systemctl status patchbox
journalctl -u patchbox -n 50 -f  # Follow logs
```

## Web UI

After starting, access the UI at:

```
http://<hostname>:9191
```

Default port is 9191 (configurable in config.toml).

See the sections below for detailed guides on deployment, upgrades, and troubleshooting common issues.
