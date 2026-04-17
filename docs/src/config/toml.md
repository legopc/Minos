# config.toml Reference

## Top-Level Fields

- **`rx_channels`** (required, usize): Number of Dante RX (input) channels. Example: `rx_channels = 16`.
- **`tx_channels`** (required, usize): Number of Dante TX (output) channels. Example: `tx_channels = 8`.
- **`sources`** (required, Vec[String]): Human-readable names for each RX channel. Length must equal `rx_channels`.
- **`zones`** (required, Vec[String]): Human-readable names for each TX channel. Length must equal `tx_channels`.
- **`input_gain_db`** (Vec[f32]): Per-input gain in dB. Default: all 0.0 (unity).
- **`output_gain_db`** (Vec[f32]): Per-output gain in dB. Default: all 0.0.
- **`matrix`** (required, Vec[Vec[bool]]): Routing grid [tx][rx]. Example: `true` at [0][0] routes source 0 to zone 0.
- **`matrix_gain_db`** (Vec[Vec[f32]]): Per-crosspoint gain in dB (applied when matrix[tx][rx] = true). Default: 0.0 (unity).
- **`dante_name`** (required, String): Dante device name (visible on Dante Controller). Example: `dante_name = "patchbox"`.
- **`dante_nic`** (required, String): Network interface for Dante (e.g., `eth0`, `ens0`).
- **`port`** (required, u16): HTTP port for web UI + API. Example: `port = 9191`.
- **`rx_jitter_samples`** (usize): RX buffer depth in samples (48 kHz). Default: 48 (1 ms). Increase to 192 (4 ms) if audio drops.
- **`lead_samples`** (usize): TX lead-ahead in samples. Default: 48. Increase if clicks occur.
- **`gain_ramp_ms`** (f32): Fader ramp time for smooth gain transitions. Default: 10 ms.
- **`zone_config`** (Vec[ZoneConfig]): Zone definitions with colour indices (0–9).
- **`input_dsp`** (Vec[InputChannelDsp]): Per-input DSP chain (gain, EQ, compression, etc.).
- **`output_dsp`** (Vec[OutputChannelDsp]): Per-output DSP chain (gain, limiter, delay, etc.).
- **`internal_buses`** (Vec[InternalBusConfig]): Submix buses.
- **`vca_groups`** (Vec[VcaGroupConfig]): VCA master groups for grouping channels.
- **`scene_crossfade_ms`** (f32): Fade time when recalling scenes (0 = instant). Default: 0.

See `config.toml.example` in the repo for a complete example with all DSP processor options (EQ, gate, compressor, AEC, automixer, feedback suppressor, dynamic EQ).
