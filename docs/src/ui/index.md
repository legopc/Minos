# UI Tour

Minos provides a web-based interface with the following main tabs:

- **Mixer**: Vertical fader strips for inputs + zone masters. Gain, mute, solo, and DSP access per channel.
- **Matrix**: Routing grid (zones as rows, sources as columns). Per-crosspoint on/off and gain control.
- **Zones**: Zone master cards with colour-coded output channels grouped by zone.
- **Panels (DSP)**: Floating DSP processor editor windows (open from Mixer/Zones tabs).
- **Scenes**: Scene recall, creation, and management.
- **System**: Health, version, Dante status, PTP sync, and configuration info.

All tabs support **real-time** parameter updates via WebSocket. Changes persist to the config file on disk when applicable.

Navigate the UI using tab buttons at the top, or use keyboard shortcuts (see System tab for help).
