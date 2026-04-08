//! S-01 + S-05: API key authentication and RBAC middleware.
//!
//! When `Config.api_keys` is non-empty, every request to `/api/v1/*` must
//! present a valid token via:
//!   - `X-Api-Key: <token>` header, OR
//!   - `Authorization: Bearer <token>` header
//!
//! The `/health` endpoint is exempt so load-balancer probes don't need keys.
//! Static assets and the WebSocket upgrade are also exempt.
//!
//! On success the `Role` is inserted as an axum extension so downstream
//! handlers can enforce fine-grained access control (S-05).

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::config::Role;
use crate::state::AppState;

/// Axum middleware function for API key + RBAC validation.
pub async fn require_api_key(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let keys = &state.config.api_keys;

    // Auth disabled — inject Admin role and pass through.
    if keys.is_empty() {
        req.extensions_mut().insert(Role::Admin);
        return Ok(next.run(req).await);
    }

    // /health is always exempt.
    if req.uri().path().ends_with("/health") {
        req.extensions_mut().insert(Role::ReadOnly);
        return Ok(next.run(req).await);
    }

    let token = extract_token(req.headers());

    match token.and_then(|t| keys.get(t)) {
        Some(entry) => {
            req.extensions_mut().insert(entry.role.clone());
            Ok(next.run(req).await)
        }
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

/// S-05: Extract the role injected by `require_api_key`.
/// Returns `Role::ReadOnly` if no role extension was set (safety default).
pub fn role_from_request(req: &Request) -> Role {
    req.extensions().get::<Role>().cloned().unwrap_or(Role::ReadOnly)
}

fn extract_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    // X-Api-Key header (preferred for device clients)
    if let Some(v) = headers.get("x-api-key") {
        return v.to_str().ok();
    }
    // Authorization: Bearer <token>
    if let Some(v) = headers.get("authorization") {
        let s = v.to_str().ok()?;
        return s.strip_prefix("Bearer ");
    }
    None
}
