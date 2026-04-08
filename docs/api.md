# API Reference

Base URL: `http://<device>:9191/api/v1`

All requests to `/api/v1/*` (except `/auth/login` and `/health`) require a valid session:

```
Authorization: Bearer <jwt-token>
```

Or for API-key clients (when `api_keys` is configured):

```
X-Api-Key: <api-key>
```

All request/response bodies are JSON unless noted.

---

## Authentication

### `POST /auth/login`

Authenticate using a Linux system account (PAM). Returns a JWT token.

**No auth header required.**

**Request body:**
```json
{ "username": "admin", "password": "secret" }
```

**Response 200:**
```json
{
  "token":    "eyJ...",
  "username": "admin",
  "role":     "admin",
  "zone":     null
}
```

- `role`: one of `admin`, `operator`, `bar_staff`, `readonly`
- `zone`: non-null for `bar_staff` users (e.g. `"bar-1"`) — the UI auto-redirects to `#/zone/<zone>`
- Token valid for 8 hours
- Token secret regenerates on server restart — all tokens are invalidated when the server restarts

**Error 401:**
```json
{ "error": "invalid credentials" }
```

**Error 503:**
```json
{ "error": "auth service unavailable" }
```
PAM service is unavailable. Check `/etc/pam.d/patchbox` or `/etc/pam.d/sshd`.

---

### `GET /auth/whoami`

Validate the stored JWT and return the claims. Used by the web UI on page load to check if a stored session is still valid.

**Requires `Authorization: Bearer <token>` header.**

**Response 200:**
```json
{
  "username": "admin",
  "role":     "admin",
  "zone":     null,
  "exp":      1234567890
}
```

**Error 401:** `{ "error": "no token" }` or `{ "error": "invalid token" }`

---

## Health

### `GET /health`

Returns service health and basic config. **No auth required.**

**Response 200:**
```json
{
  "status":      "ok",
  "version":     "0.1.0",
  "inputs":      8,
  "outputs":     8,
  "device_name": "dante-patchbox",
  "uptime_secs": 3600,
  "ws_connections": 2,
  "ptp_offset_ns": 150
}
```

- `ptp_offset_ns`: PTP clock offset from `/run/statime/offset` (null if unavailable)

---

## State

### `GET /state`

Returns the full parameter snapshot. Use this for initial UI load.

**Response 200:**
```json
{
  "dante_rx_active": [true, false, ...],
  "input_order":  [0, 1, 2, ...],
  "output_order": [0, 1, 2, ...],
  "matrix": {
    "inputs":  8,
    "outputs": 8,
    "cells":   [1.0, 0.0, 0.0, ...]
  },
  "inputs": [
    {
      "label":      "IN 1",
      "gain_trim":  1.0,
      "mute":       false,
      "solo":       false,
      "pan":        0.0,
      "hpf":        { "enabled": false, "hz": 80.0 },
      "eq":         { "enabled": false, "bands": [...] },
      "compressor": null
    },
    ...
  ],
  "outputs": [
    {
      "label":       "OUT 1",
      "master_gain": 1.0,
      "mute":        false,
      "compressor":  { "enabled": false, "threshold_db": -20.0, "ratio": 4.0, "attack_ms": 10.0, "release_ms": 100.0, "makeup_gain_db": 0.0 }
    },
    ...
  ]
}
```

- `cells`: flat row-major array — `cells[i * n_outputs + o]` = gain for input `i` → output `o`
- Gain range: `0.0` (silent) to `~4.0` (≈ +12 dBFS). Unity = `1.0`
- `dante_rx_active`: whether each Dante RX channel has an active subscription
- `input_order` / `output_order`: channel display order (indices, may differ from 0…N if reordered)

**ETag support:** Response includes `ETag: W/"<version>"`. Use `If-Match` on writes to detect stale state.

---

## Matrix

### `PATCH /matrix/:in/:out`

Set the gain for a single cross-point.

- `:in` — input channel index (0-based)
- `:out` — output channel index (0-based)

**Request body:**
```json
{ "gain": 0.75 }
```

Gain is clamped to `[0.0, 4.0]`. Unity = `1.0`. `0.0` = silence.

**Response:** `204 No Content`
**Error 422:** index out of range

Supports `If-Match: W/"<etag>"` for optimistic concurrency — returns `412 Precondition Failed` on stale write.

---

## Input channels

All input channel endpoints use 0-based `:id`.

### `POST /channels/input/:id/mute`

Toggle mute on an input strip. No body required.

**Response:** `204 No Content`

---

### `POST /channels/input/:id/solo`

Toggle solo on an input strip. No body required.

**Response:** `204 No Content`

---

### `POST /channels/input/:id/name`

Rename an input strip (max 64 chars).

```json
{ "name": "Mic 1" }
```

**Response:** `204 No Content`

---

### `POST /channels/input/:id/gain_trim`

Set the input gain trim (pre-fader gain boost/cut).

```json
{ "gain": 1.5 }
```

Gain range: `[0.0, 4.0]`. Unity = `1.0`.

**Response:** `204 No Content`

---

### `POST /channels/input/:id/eq`

Set the 4-band parametric EQ for an input.

```json
{
  "enabled": true,
  "bands": [
    { "enabled": true,  "band_type": "low_shelf",  "freq_hz": 100,   "gain_db": 3.0,  "q": 0.707 },
    { "enabled": true,  "band_type": "peak",        "freq_hz": 500,   "gain_db": -2.0, "q": 1.0   },
    { "enabled": false, "band_type": "peak",        "freq_hz": 3000,  "gain_db": 0.0,  "q": 1.0   },
    { "enabled": true,  "band_type": "high_shelf",  "freq_hz": 10000, "gain_db": 1.5,  "q": 0.707 }
  ]
}
```

`band_type`: `low_shelf` | `peak` | `high_shelf`

**Response:** `204 No Content`

---

### `POST /channels/input/:id/pan`

Set the pan/balance position for an input.

```json
{ "pan": -0.5 }
```

Range: `-1.0` (hard left) to `1.0` (hard right). `0.0` = centre.

**Response:** `204 No Content`

---

### `POST /channels/input/:id/hpf`

Set the high-pass filter for an input.

```json
{ "enabled": true, "hz": 80.0 }
```

**Response:** `204 No Content`

---

### `POST /channels/input/reorder`

Reorder input channel display order.

```json
{ "order": [3, 0, 1, 2, 4, 5, 6, 7] }
```

`order` must be a permutation of `[0, n_inputs)`. The server validates and stores the order for UI display.

**Response:** `204 No Content`

---

## Output channels

All output channel endpoints use 0-based `:id`.

### `POST /channels/output/:id/mute`

Toggle mute on an output bus.

**Response:** `204 No Content`

---

### `POST /channels/output/:id/name`

Rename an output bus (max 64 chars).

```json
{ "name": "Main L" }
```

**Response:** `204 No Content`

---

### `POST /channels/output/:id/master_gain`

Set the output bus master gain.

```json
{ "gain": 0.8 }
```

Range: `[0.0, 4.0]`. Unity = `1.0`.

**Response:** `204 No Content`

---

### `POST /channels/output/:id/compressor`

Set the compressor/limiter for an output bus.

```json
{
  "enabled":        true,
  "threshold_db":   -20.0,
  "ratio":          4.0,
  "attack_ms":      10.0,
  "release_ms":     100.0,
  "makeup_gain_db": 0.0
}
```

- `threshold_db`: range `-60.0` to `0.0`
- `ratio`: `1.0` (bypass) to `20.0` (limiting)
- `attack_ms`: `0.1` to `200.0`
- `release_ms`: `10.0` to `2000.0`
- `makeup_gain_db`: `-20.0` to `+20.0`

**Response:** `204 No Content`

---

### `POST /channels/output/reorder`

Reorder output channel display order.

```json
{ "order": [0, 2, 1, 3, 4, 5, 6, 7] }
```

**Response:** `204 No Content`

---

## Scenes

Scenes save and restore the **full** matrix state (all gains, channel names, mute/solo, EQ, compressor).

### `GET /scenes`

List all saved scene names.

**Response 200:**
```json
["default", "rehearsal", "show"]
```

---

### `POST /scenes`

Save the current live state as a named scene.

```json
{ "name": "friday-night" }
```

**Response:** `204 No Content`

---

### `GET /scenes/:name`

**Read** a saved scene (does NOT apply it — returns the JSON for diffing).

**Response 200:** Scene JSON object.

---

### `POST /scenes/:name/load`

**Apply** a saved scene (replaces live matrix state immediately).

**Response:** `204 No Content`
**Error 404:** scene not found

---

### `DELETE /scenes/:name`

Delete a saved scene file.

**Response:** `204 No Content`

---

## Zones

Zones group output channels into named areas (e.g. bars). Configured in `config.toml`.

### `GET /zones`

List all configured zones.

**Response 200:**
```json
[
  { "id": "bar-1", "outputs": [0, 1] },
  { "id": "bar-2", "outputs": [2, 3] }
]
```

---

### `GET /zones/:zone_id`

Zone-scoped state — matrix rows and output channels filtered to this zone's outputs only. Used by bar-staff tablets.

**Response 200:** Same structure as `GET /state` but with only the zone's outputs.

---

### `POST /zones/:zone_id/master-gain`

Set the master gain for all outputs in a zone simultaneously.

```json
{ "gain": 0.8 }
```

**Response:** `204 No Content`

---

### `GET /zones/:zone_id/presets`

List saved presets for a zone.

**Response 200:**
```json
["quiet", "busy", "karaoke"]
```

---

### `POST /zones/:zone_id/presets`

Save the current zone state as a named preset.

```json
{ "name": "quiet" }
```

**Response:** `204 No Content`

---

### `POST /zones/:zone_id/presets/:name/load`

Apply a zone preset (restores zone-specific gains only).

**Response:** `204 No Content`

---

### `DELETE /zones/:zone_id/presets/:name`

Delete a zone preset.

**Response:** `204 No Content`

---

## Templates

Routing templates save and restore only the **matrix crosspoint connections** (gains), without touching channel names, DSP settings, or fader levels. Useful for quickly switching signal routing presets.

### `GET /templates`

List all saved routing templates.

**Response 200:**
```json
["live-band", "background-music", "karaoke"]
```

---

### `POST /templates`

Save the current matrix crosspoints as a named template.

```json
{ "name": "live-band" }
```

**Response:** `204 No Content`

---

### `POST /templates/:name/load`

Apply a routing template (crosspoint gains only).

**Response:** `204 No Content`

---

### `DELETE /templates/:name`

Delete a routing template.

**Response:** `204 No Content`

---

## WebSocket `/ws`

Connect to: `ws://<device>:9191/ws?token=<jwt>`

Token is required when `api_keys` is non-empty. The UI also sends the token as a query parameter regardless.

### On connect — snapshot (text, JSON)

```json
{
  "op":    "snapshot",
  "state": { ...same as GET /state... }
}
```

### Continuous metering (~20 Hz, binary)

Raw `Float32Array` (little-endian IEEE 754):

```
[in_0_dBFS, in_1_dBFS, ..., in_N_dBFS,
 out_0_dBFS, out_1_dBFS, ..., out_M_dBFS]
```

Total: `(n_inputs + n_outputs) × 4` bytes.
Range: typically `-60` (silence) to `0` (0 dBFS). Values above 0 = clipping.

### Client → server

Not currently used. Reserved for future control ops.

---

## Error format

```json
{ "error": "description of what went wrong" }
```

Common HTTP status codes:
- `400 Bad Request` — malformed body or invalid parameter value
- `401 Unauthorized` — missing or invalid token
- `403 Forbidden` — role doesn't have permission
- `404 Not Found` — resource (scene, channel, zone) doesn't exist
- `409 Conflict` — duplicate resource name
- `412 Precondition Failed` — optimistic concurrency check failed (`If-Match`)
- `422 Unprocessable Entity` — valid JSON but semantically invalid (e.g. channel index out of range)
- `429 Too Many Requests` — rate limit hit (200 burst global)
- `503 Service Unavailable` — PAM/auth service unavailable

---

## Prometheus metrics

Available on `port+1` (default 9192). No auth required.

```
curl http://localhost:9192/metrics
```

Key metrics:
- `patchbox_ws_connections` — active WebSocket connections
- `patchbox_uptime_seconds` — server uptime
