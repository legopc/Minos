# Configuration

Minos is configured via TOML files and runtime API calls.

## Configuration Files

- **`/etc/patchbox/config.toml`** (production): Main configuration loaded on startup.
- **`config.toml.example`** (in repo): Example configuration with all options documented.

## Structure

The configuration defines:

- Number of Dante channels (RX/TX) and zone layout.
- Network interface and Dante device name.
- DSP settings for all inputs, buses, and outputs.
- Internal buses and VCA groups.
- Scene crossfade time and jitter buffer tuning.
- Optional monitoring (PFL), signalling generators, automixer groups.

## Runtime Changes

All parameters are mutable via the Web UI or API. Changes are applied immediately to the audio stream and optionally saved back to config.toml.

## Persistence

When you edit the mixer in the UI (e.g., route a crosspoint, adjust gain, enable compression), the configuration is updated in-memory. On graceful shutdown, the config is flushed to disk. For immediate persistence, use the API `/save-config` endpoint.

See the sections below for detailed reference on config.toml syntax and Dante setup.
