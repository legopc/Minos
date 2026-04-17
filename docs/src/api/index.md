# API Reference

Minos provides a JSON REST API over HTTP for programmatic control of routing, DSP, and state.

## Base URL

```
http://<host>:<port>/api
```

Default port is 9191 (configurable in config.toml).

## Authentication

All API endpoints require JWT (JSON Web Token) authentication, passed as a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Requests without a valid token receive HTTP 401 Unauthorized.

**TODO**: JWT generation and refresh flow details will be documented as part of the `s7-ops-openapi` project when full OpenAPI spec is published.

## Response Format

- **Success** (2xx): JSON response body with result data.
- **Client Error** (4xx): JSON error object: `{"error": "description"}`.
- **Server Error** (5xx): JSON error object with details.

## Endpoints

See the [Endpoints](./endpoints.md) page for available API routes.

## WebSocket

In addition to REST, Minos supports **WebSocket** connections at `/ws` for real-time parameter updates and state streaming. The web UI uses WebSocket to send parameter changes and receive config updates.

## Swagger UI

When the full OpenAPI spec is published, an interactive Swagger UI will be available at `/api/docs`.
