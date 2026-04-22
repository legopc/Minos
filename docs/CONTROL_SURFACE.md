# Control Surface Integration (S8)

MIDI and OSC control surface bridge for Minos. Implemented in the
`patchbox-control-surface` crate. Hardware targets: Behringer BCF2000,
Mackie X-Touch Compact, TouchOSC on iPad.

---

## Architecture

```
[Hardware / TouchOSC]
        │ MIDI / OSC UDP
        ▼
patchbox-control-surface
  ├── MidiListener     — receives MIDI CC, Note On/Off, pitch-bend
  ├── OscListener      — receives OSC UDP datagrams on port 9192
  ├── MappingTable     — translates incoming messages to API actions
  ├── FeedbackEngine   — sends state changes back to hardware (motor faders, LEDs)
        │ REST / in-process AppState
        ▼
patchbox (HTTP API / AppState)
```

Control surface runs as an async task started alongside the main server.
It reads from `AppState` via the same `Arc<RwLock<PatchboxConfig>>` the API uses.
Outgoing feedback is debounced (10 ms) to avoid flooding motorised faders.

---

## MIDI Protocol

### Port Discovery

`midir` enumerates all MIDI ports. The active port name is set in `config.toml`:

```toml
[control_surface]
midi_port = "BCF2000"          # partial match, case-insensitive
osc_port  = 9192
osc_bind  = "0.0.0.0"
enabled   = true
```

If `midi_port` is not set, MIDI is disabled. Startup logs all available port names.

### BCF2000 Default Mapping

| MIDI | CC / Note | Action |
|------|-----------|--------|
| CC 1–8 | Encoder 1–8 | Input channel gain (row 0–7) |
| CC 9–16 | Encoder 9–16 | Output zone volume (zones 0–7) |
| CC 81–88 | Fader 1–8 | Input channel gain (high res) |
| Note On 0–7 | Button row 1 | Toggle mute on input 0–7 |
| Note On 8–15 | Button row 2 | Toggle mute on output 0–7 |
| Note On 40 | STORE | Save scene |
| Note On 41 | REC | Recall active scene |
| Pitch bend ch1–8 | — | Fine gain on inputs 0–7 (14-bit) |

Fader values: 7-bit (0–127) mapped to −60 dB (0) → 0 dB (100) → +6 dB (127) using
the same log taper as the web UI (`gain_db = 6.0 * (v/127.0)^2 - 60.0*(1 - v/127.0)`).

### X-Touch Compact Mapping

Uses Mackie Control protocol (MCU). CCs and notes differ — configure in
`[control_surface.profiles.xtouch]` TOML section (not yet specified; add in S8).

---

## OSC Protocol

Listens on UDP port 9192. OSC address space:

| Address | Args | Direction | Action |
|---------|------|-----------|--------|
| `/minos/input/{ch}/gain` | `f` dB | in/out | Set/query input gain |
| `/minos/input/{ch}/mute` | `i` 0/1 | in/out | Mute input channel |
| `/minos/output/{ch}/volume` | `f` dB | in/out | Set/query zone volume |
| `/minos/output/{ch}/mute` | `i` 0/1 | in/out | Mute output zone |
| `/minos/matrix/{tx}/{rx}` | `i` 0/1 | in/out | Enable/disable crosspoint |
| `/minos/scene/recall/{name}` | — | in | Recall named scene |
| `/minos/scene/save/{name}` | — | in | Save current state as scene |
| `/minos/query` | — | in | Server replies with full state bundle |

Outgoing feedback: state changes from any source (web UI, MIDI, API) are
broadcast to all connected OSC clients as OSC bundles on port 9193.
Clients register by sending `/minos/subscribe` with their IP:port.

---

## MappingTable

`MappingTable` holds a `Vec<MappingRule>`:

```rust
pub struct MappingRule {
    pub source: MappingSource,   // Midi(MidiMsg) | Osc(OscAddr)
    pub action: MappingAction,   // SetInputGain | SetOutputVolume | ToggleMute | RecallScene | ...
}
```

Default mappings are compiled in (see BCF2000 table above).
User overrides loaded from `config.toml [control_surface.mappings]` section.
Mappings are applied in order; first match wins.

---

## FeedbackEngine

Sends hardware feedback when AppState changes:

- **Motor faders**: sends MIDI pitchbend (14-bit) when gain changes externally
- **Button LEDs**: sends Note On (velocity 127 = lit) when mute state changes
- **Scribble strips** (X-Touch): sends SysEx with channel name when label changes

Debounce: 10 ms per control. Feedback is suppressed for 50 ms after the
control itself caused the change (to avoid echo loops).

---

## Configuration (`config.toml`)

```toml
[control_surface]
enabled      = false          # default off — set true to activate
midi_port    = ""             # e.g. "BCF2000" — leave empty to disable MIDI
osc_port     = 9192           # UDP port to listen on (incoming)
osc_bind     = "0.0.0.0"      # bind address
osc_out_port = 9193           # UDP port for outgoing feedback
profile      = "bcf2000"      # "bcf2000" | "xtouch" | "generic"
```

---

## Implementation Checklist (S8)

- [ ] `midi.rs`: `MidiListener` — `midir` port open, CC/Note On receiver, normalization to `MidiMsg`
- [ ] `osc.rs`: `OscListener` — `rosc` UDP socket, parse bundles + messages
- [ ] `mapping.rs`: `MappingTable` — default BCF2000 rules, TOML override loading
- [ ] `feedback.rs`: `FeedbackEngine` — debounced MIDI CC/pitchbend/LED output, OSC broadcast
- [ ] Cargo.toml: add `midir = "0.10"`, `rosc = "0.10"`, `tokio`, `serde` deps
- [ ] Wire into `patchbox/src/main.rs`: `spawn` the control surface task after server starts
- [ ] Add `[control_surface]` block to config schema and config.toml reference docs
- [ ] X-Touch profile implementation (after BCF2000 is stable)
