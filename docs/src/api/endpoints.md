# Endpoints

## Available Endpoints

The following endpoints are implemented. Full details will be available in the OpenAPI/Swagger spec when `s7-ops-openapi` is complete.

### State & Configuration

- **`GET /api/state`**: Fetch current mixer state (routing, levels, DSP settings).
- **`POST /api/state`**: Update mixer state (bulk parameter changes).
- **`GET /api/config`**: Fetch the current config.toml as JSON.
- **`POST /api/config`**: Update configuration (partial or full).
- **`POST /api/save-config`**: Force write current config to disk.

### Routing Matrix

- **`GET /api/matrix`**: Fetch the full routing matrix.
- **`PUT /api/matrix/:tx/:rx`**: Set a crosspoint (true = route, false = unroute).
- **`GET /api/matrix/:tx/:rx`**: Get crosspoint state.

### Mixer Control

- **`PUT /api/channel/:rx/gain`**: Set input channel gain (dB).
- **`PUT /api/output/:tx/gain`**: Set output channel gain (dB).
- **`PUT /api/output/:tx/mute`**: Set output mute state (true/false).

### Scenes

- **`GET /api/scenes`**: List all saved scenes.
- **`POST /api/scenes`**: Create a new scene from current state.
- **`POST /api/scenes/:id/recall`**: Recall a scene (instant or with crossfade).
- **`DELETE /api/scenes/:id`**: Delete a scene.

### System & Health

- **`GET /api/health`**: Health check (uptime, Dante status, PTP offset, buffer stats).
- **`GET /api/version`**: Server version info.

### WebSocket

- **`WS /ws`**: WebSocket endpoint for real-time parameter updates and state streaming.

**TODO**: Full OpenAPI specification with request/response schemas, error codes, and examples will be published as part of the `s7-ops-openapi` project. See `/api/docs` (future).
