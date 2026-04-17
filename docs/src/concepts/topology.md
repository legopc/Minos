# Topology: Inputs, Outputs, Buses, Zones

## Inputs (RX)

Each Dante RX channel is an audio source entering the system. The number of inputs is configured in `config.toml` via `rx_channels`. Each input can be:

- **Named**: Human-readable label (e.g., "Mic 1", "Line In").
- **Coloured**: Optional accent colour (0–9) for visual grouping in the Mixer tab.
- **Routed**: Via the Matrix, to any or all TX outputs.
- **Processed**: Full DSP chain (gain, HPF, LPF, 5-band EQ, gate, compressor, AEC, feedback suppression, dynamic EQ, automixer).

## Outputs (TX) & Zones

Dante TX channels are audio destinations (zone outputs). Grouped into **zones**—named sets of TX channels with a colour palette entry. Each output supports:

- **Independent DSP**: EQ, compression, brick-wall limiter, delay, dither, dynamic EQ.
- **Mute control**: Per-output or per-zone.
- **Gain/fading**: Per-output volume with configurable gain-ramp time (default 10 ms) for zipper-free transitions.

## Buses

Internal submix channels that sum multiple inputs, apply processing (like input channels), and feed any or all outputs. Useful for:

- Complex multi-destination mixes without duplicating sources.
- Dedicated processing chains per submix.
- Feed-back loops (bus feeds another bus) for nested mixing.

Bus routing is controlled via `bus_matrix` in config.

## Routing Matrix

The **Matrix** tab shows a 2D grid: Rows = zones (TX), columns = sources (RX). Each cell represents a crosspoint:

- **ON/OFF toggle**: Routes a source to a zone.
- **Per-crosspoint gain**: In dB, applied when the crosspoint is active (default 0.0 = unity).

From the Matrix, you can also lock/solo/copy crosspoints and adjust crosspoint gain in real-time.
