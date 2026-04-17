# Authentication

All Minos API endpoints require JWT (JSON Web Token) authentication.

## Request Format

Include the JWT in the `Authorization` header as a Bearer token:

```
GET /api/state HTTP/1.1
Host: localhost:9191
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Unauthenticated Requests

Requests without a valid `Authorization` header return:

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error": "Missing or invalid token"}
```

## Token Generation

**TODO**: Documentation for JWT token generation, refresh flow, and credential management will be published when the `s7-ops-openapi` project is complete.

For now, refer to the `/web/src/js/api.js` source code to see how the web UI obtains and manages tokens.

## Token Expiration

Tokens have an expiration time. Expired tokens also return 401; refresh the token and retry.

## Development / Testing

For local testing, check the backend source code for token generation functions, or see how the web UI login flow works in `web/src/js/api.js`.
