# Panels (DSP)

The **Panels** system provides floating, draggable windows for real-time DSP editing.

## Opening a DSP Panel

Click the **DSP icon** (⚙ or similar) on any:

- Input strip (Mixer tab)
- Zone output card (Zones tab)
- Internal bus fader (if visible)

This opens a floating window for that channel's DSP chain.

## Panel Contents

Each panel displays the full DSP chain for the selected channel:

- **Header**: Channel name, close button (✕), panel title.
- **DSP blocks**: Organized by processor type (Gain, HPF, LPF, EQ, Gate, Compressor, etc.).
- **Enable toggles**: Turn each processor on/off without losing settings.
- **Parameter controls**: Sliders, text inputs, dropdowns for each processor's parameters.

## Interaction

- **Drag panel**: Click and hold the header to move the panel around.
- **Adjust parameters**: Faders, knobs, and text inputs update in real-time.
- **Z-stacking**: Panels layer on top of each other; click a panel to bring it to front.
- **Close**: Click ✕ to close the panel (does NOT reset parameters).

## DSP Block Types (Input/Bus)

- Gain, Polarity, HPF, LPF, EQ, Gate, Compressor, AEC, Automixer, Feedback Suppressor, Dynamic EQ

## DSP Block Types (Output)

- Gain, Mute, Polarity, HPF, LPF, EQ, Compressor, Limiter, Delay, Dither, Dynamic EQ

All parameter changes are sent immediately via WebSocket to the backend and persisted to the running config.
