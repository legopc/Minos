//! S-01 + S-05 + A-01: API key / JWT authentication and RBAC middleware.
//!
//! Accepts:
//!   - X-Api-Key: <api-key>             (static key from config)
//!   - Authorization: Bearer <api-key>  (static key)
//!   - Authorization: Bearer <jwt>      (A-01: PAM-issued JWT token)
//!
//! When `Config.api_keys` is empty (development), the middleware passes through
//! all requests with Admin role. When non-empty, every request must authenticate.

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::api::jwt;
use crate::config::Role;
use crate::state::AppState;

/// Axum middleware function for API key / JWT RBAC validation.
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

    // /health and /auth/login are always exempt.
    let path = req.uri().path();
    if path.ends_with("/health") || path.ends_with("/auth/login") {
        req.extensions_mut().insert(Role::ReadOnly);
        return Ok(next.run(req).await);
    }

    let bearer = extract_bearer(req.headers());

    // 1. Try JWT token first (A-01)
    if let Some(t) = bearer {
        if let Ok(claims) = jwt::validate(t, &state.jwt_secret) {
            let role = match claims.role.as_str() {
                "admin"     => Role::Admin,
                "operator"  => Role::Operator,
                "bar_staff" => Role::BarStaff,
                _           => Role::ReadOnly,
            };
            req.extensions_mut().insert(role);
            return Ok(next.run(req).await);
        }
    }

    // 2. Try static API key
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

fn extract_bearer(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers.get("authorization")?.to_str().ok()?.strip_prefix("Bearer ")
}

fn extract_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    // X-Api-Key header (preferred for device clients)
    if let Some(v) = headers.get("x-api-key") {
        return v.to_str().ok();
    }
    // Authorization: Bearer <token>
    extract_bearer(headers)
}
