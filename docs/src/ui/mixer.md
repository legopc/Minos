# Mixer Tab

The **Mixer** tab displays all input channels as vertical fader strips, zone master controls on the right, and internal buses below (if enabled).

## Input Strips

Each input strip shows:

- **Channel name** (e.g., "Mic 1", "Line In").
- **Colour indicator** (if assigned, 0–9 palette).
- **Gain fader**: Adjust input level in dB.
- **Meter**: Real-time audio level display.
- **Mute button**: Silence the input in the mix.
- **Solo button**: Solo this input (mutes all others; click CLEAR SOLO bar to exit).
- **DSP icon**: Click to open the DSP panel for this channel (EQ, compression, gate, etc.).

Hold **Shift** + click channel faders to fine-tune or adjust multiple channels at once.

## Zone Masters

On the right side, one master fader per zone (TX output). Shows:

- **Zone name** (e.g., "Main", "Zone 2").
- **Zone colour** matching the zone configuration.
- **Output master fader**: Zone-level volume control.
- **Output mute**: Mute the entire zone.
- **Output level meter**.

## Scene Bar & Solo Indicator

At the top, a scene selection dropdown lets you recall scenes instantly. Below that, the solo indicator bar shows when any input is soloed; click **CLEAR** to exit solo mode.

## Buses (Optional)

If `show_buses_in_mixer` is true in config, internal buses appear as additional strips below the zone masters for easy access.
