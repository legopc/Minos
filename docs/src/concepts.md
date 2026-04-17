# Concepts

Minos operates around a few core domain concepts:

- **Inputs (RX)**: Dante audio sources flowing into the system. Each input channel has independent DSP (gain, EQ, compression, gating, feedback suppression, etc.).
- **Outputs (TX)**: Dante audio destinations (zones). Each zone is named and coloured for visual organization.
- **Routing Matrix**: The crosspoint grid showing which inputs feed which outputs. Per-crosspoint gain control available.
- **Buses**: Internal submix channels that accept inputs, apply processing, and feed outputs—useful for complex multi-destination mixes.
- **Zones**: Logical groupings of output channels with a human-readable name and colour palette entry.
- **Scenes**: Named snapshots of the entire mixer state (routing, levels, DSP settings, zone mutes). Instant recall or crossfade between scenes.
- **DSP Chains**: Series of audio processors on each input/output/bus (EQ, compression, limiter, delay, dynamic EQ, etc.). Configured via config.toml or edited in real-time via the UI.

See detailed sections for topology, DSP architecture, and scene management.
