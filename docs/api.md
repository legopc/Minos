# API Reference

Base URL: `http://<device>:8080/api/v1`

All request/response bodies are JSON unless noted. All timestamps are ISO 8601.

---

## Health

### `GET /health`

Returns service health and basic config.

**Response 200:**
```json
{
  "status":  "ok",
  "version": "0.1.0",
  "inputs":  8,
  "outputs": 8
}
```

---

## State

### `GET /state`

Returns the full parameter snapshot — matrix, all input strips, all output buses.

**Response 200:**
```json
{
  "matrix": {
    "inputs":  8,
    "outputs": 8,
    "cells":   [1.0, 0.0, 0.0, ...]
  },
  "inputs": [
    { "label": "IN 1", "gain_trim": 1.0, "mute": false, "solo": false },
    ...
  ],
  "outputs": [
    { "label": "OUT 1", "master_gain": 1.0, "mute": false },
    ...
  ]
}
```

`cells` is a flat row-major array: `cells[i * n_outputs + o]` = gain for input `i` → output `o`.
Gain range: `0.0` (silent) to `~4.0` (≈ +12 dBFS). Unity = `1.0`. Muted cross-point = `0.0`.

---

## Matrix

### `PATCH /matrix/:in/:out`

Set the gain for a single cross-point.

**Path parameters:**
- `:in` — input channel index (0-based)
- `:out` — output channel index (0-based)

**Request body:**
```json
{ "gain": 0.75 }
```

**Response:** `204 No Content`  
**Error:** `422 Unprocessable Entity` if indices are out of range.

---

## Input channels

### `POST /channels/input/:id/mute`

Toggle mute on an input strip. No body required.

**Response:** `204 No Content`  
**Error:** `404 Not Found`

---

### `POST /channels/input/:id/solo`

Toggle solo on an input strip. No body required.

**Response:** `204 No Content`  
**Error:** `404 Not Found`

---

### `POST /channels/input/:id/name`

Rename an input strip.

**Request body:**
```json
{ "name": "Mic 1" }
```

**Response:** `204 No Content`

---

## Output channels

### `POST /channels/output/:id/mute`

Toggle mute on an output bus.

**Response:** `204 No Content`

---

### `POST /channels/output/:id/name`

Rename an output bus.

**Request body:**
```json
{ "name": "Main L" }
```

**Response:** `204 No Content`

---

## Scenes

### `GET /scenes`

List all saved scene names.

**Response 200:**
```json
["default", "rehearsal", "show"]
```

---

### `POST /scenes`

Save the current state as a named scene. Overwrites if the name already exists.

**Request body:**
```json
{ "name": "my-scene" }
```

**Response:** `204 No Content`

---

### `GET /scenes/:name`

Load (apply) a saved scene. Immediately replaces the live matrix state.

**Response:** `204 No Content`  
**Error:** `404 Not Found` if scene does not exist.

---

## WebSocket `/ws`

Binary and text frames are multiplexed on the same connection.

### On connect — state snapshot (text, JSON)

```json
{
  "op": "snapshot",
  "state": { ...same structure as GET /state... }
}
```

### Continuous metering (~20 Hz, binary)

A raw `Float32Array` (little-endian IEEE 754):

```
[input_0_dBFS, input_1_dBFS, ..., input_N_dBFS,
 output_0_dBFS, output_1_dBFS, ..., output_M_dBFS]
```

Total length: `(n_inputs + n_outputs) * 4` bytes.
Range: nominally `−60` (silence) to `0` (0 dBFS). Clipping possible above `0`.

### Client → server (text, JSON)

Currently not processed. Future control ops will use `{ "op": "...", ... }`.

---

## Error format

On non-2xx responses, the body is a plain text error message:

```
index out of range: 99 >= 8
```

---

## Configuration reference

`/etc/patchbox/config.toml`:

```toml
port        = 8080           # HTTP listen port
n_inputs    = 8              # Dante RX channel count
n_outputs   = 8              # Dante TX channel count
device_name = "dante-patchbox"  # Name visible in Dante Controller
scenes_dir  = "/var/lib/patchbox/scenes"
```

All fields have defaults; the config file is optional.

Environment variable overrides:
- `PATCHBOX_CONFIG` — path to config file
- `PATCHBOX_PORT`   — override port
- `RUST_LOG`        — log filter (e.g. `patchbox=debug`)
