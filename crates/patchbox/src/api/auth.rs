//! S-01: API key authentication middleware.
//!
//! When `Config.api_keys` is non-empty, every request to `/api/v1/*` must
//! present a valid token via:
//!   - `X-Api-Key: <token>` header, OR
//!   - `Authorization: Bearer <token>` header
//!
//! The `/health` endpoint is exempt so load-balancer probes don't need keys.
//! Static assets and the WebSocket upgrade are also exempt.

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::state::AppState;

/// Axum middleware function for API key validation.
pub async fn require_api_key(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let keys = &state.config.api_keys;

    // Auth disabled — pass through.
    if keys.is_empty() {
        return Ok(next.run(req).await);
    }

    // /health is always exempt.
    if req.uri().path().ends_with("/health") {
        return Ok(next.run(req).await);
    }

    let token = extract_token(req.headers());

    match token {
        Some(t) if keys.contains_key(t) => Ok(next.run(req).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
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
