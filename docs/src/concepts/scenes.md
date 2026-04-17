# Scenes

A **scene** is a named snapshot of the entire mixer state at a moment in time:

- **Full state capture**: Routing matrix, per-channel gain, DSP settings, zone mutes, VCA group levels, stereo link pans.
- **Instant recall**: Load a scene name to jump to that exact configuration instantly.
- **Crossfade**: Optional gradual transition between scenes (configurable fade time in ms).
- **Session-only**: Scenes are stored in-memory and can be saved/loaded via API calls (persistence TBD).

### Managing Scenes (UI)

In the **Scenes** tab, you can:

- Create a new scene from the current state.
- List all stored scenes.
- Recall any scene (instant or with crossfade).
- Delete a scene.
- Edit a scene name.

Scene crossfade time is controlled via `scene_crossfade_ms` in config.toml (default 0 = instant).

### Scene API

Scenes are accessible via the `/api/scenes` endpoint (see API Reference for details).
