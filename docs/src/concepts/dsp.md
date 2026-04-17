# DSP Chain

Every input, bus, and output channel has an optional DSP chain for signal processing.

## Input DSP

- **Gain**: Direct level control (dB).
- **Polarity**: Invert phase (–180°).
- **HPF** (High-Pass Filter): Roll-off low frequencies (default 80 Hz, disabled).
- **LPF** (Low-Pass Filter): Roll-off high frequencies (default 16 kHz, disabled).
- **5-Band Parametric EQ**: Centre frequencies pre-set (100 Hz, 250 Hz, 1 kHz, 4 kHz, 10 kHz); adjust gain and Q per band.
- **Gate/Expander**: Noise gate with threshold, ratio, attack/hold/release times, and range.
- **Compressor**: Dynamic range compression with threshold, ratio, knee, attack, release, makeup gain.
- **AEC** (Acoustic Echo Cancellation): Optional feature (compile with `--features aec`); specify a TX output as reference.
- **Automixer** (Dugan Gain-Sharing): Opt-in per-channel; channels in the same group share gain to avoid level-stacking.
- **Feedback Suppressor**: Automatic notch-filter feedback detection and removal (up to 8 simultaneous notches).
- **Dynamic EQ**: Up to 4 frequency-selective dynamic processors (threshold-triggered peaking/shelf EQ).

## Output DSP

- **Gain** & **Mute**: Per-output volume and mute state.
- **Polarity**: Phase inversion.
- **HPF, LPF**: High-pass and low-pass filters (same as input).
- **5-Band Parametric EQ**: Same as input.
- **Compressor**: Dynamic range compression.
- **Brick-Wall Limiter**: Brick-wall limiting with threshold (-40 to 0 dBFS), attack (0.1–50 ms), release (10–2000 ms).
- **Delay**: Sample-accurate delay (0–500 ms) for time-aligning outputs.
- **Dither**: Apply TPDF dither at 16 or 24 bits (reduces quantization noise on low-level signals).
- **Dynamic EQ**: Same as input.

## Bus DSP

Internal buses use the same DSP chain as input channels (no compressor/limiter on buses in current build).

## Real-Time Editing

Open a DSP panel from the Mixer or Zones tab by clicking the DSP icon on any channel. Panels can be dragged and repositioned on screen. Changes are applied immediately to the audio stream (via WebSocket to the backend).
