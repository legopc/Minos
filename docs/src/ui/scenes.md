# Scenes Tab

The **Scenes** tab lets you save, load, and manage named mixer snapshots.

## Scene Operations

- **Create Scene**: Click "New Scene" → enter a name → save the current mixer state as a snapshot.
- **List Scenes**: View all saved scenes with timestamps and description fields.
- **Recall Scene**: Click a scene name to load it instantly (or with crossfade if configured).
- **Delete Scene**: Remove a scene from storage.
- **Edit Name/Notes**: Rename a scene or add descriptive text (optional).

## Crossfade

When you recall a scene, if `scene_crossfade_ms` > 0 in config.toml, the mixer fades smoothly from the current state to the target scene over that duration. During crossfade, controls are locked.

## What's Captured in a Scene

- **Routing matrix**: All crosspoint states (on/off) and per-crosspoint gains.
- **Input levels**: Per-channel gain (note: input_gain_db in config, or per-channel DSP gain if using input DSP).
- **Output levels**: Per-zone/channel master gain and mute states.
- **DSP settings**: All processor parameters (EQ, compression, gating, etc.) on all channels.
- **Zone mutes**: Per-zone mute state.
- **VCA groups**: Level and mute state of any VCA master groups.
- **Stereo links**: Pan values if stereo pairing is enabled.

## Persistence

Scenes are currently stored in-memory (session-only). See roadmap for file-based scene persistence.
