//! Login endpoint + JWT middleware extractor

use crate::{jwt, pam_auth, state::AppState};
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub role: String,
    pub zone: Option<String>,
    pub expires_in: u64,
}

/// POST /api/v1/login
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    // Authenticate via PAM
    let pam_result = pam_auth::authenticate("patchbox", &req.username, &req.password).await;
    if let Err(e) = pam_result {
        tracing::warn!("login failed for {}: {}", req.username, e);
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid credentials"})),
        )
            .into_response();
    }

    // Determine role from Linux groups
    let username = req.username.clone();
    let (role, zone) = tokio::task::spawn_blocking(move || pam_auth::role_for_user(&username))
        .await
        .unwrap_or(("readonly", None));

    // Issue JWT
    let claims = jwt::Claims::new(&req.username, role, zone.clone());
    let secret = state.jwt_secret.read().await;
    let token = match jwt::generate(&claims, &secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("jwt generation failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "token error"})),
            )
                .into_response();
        }
    };

    tracing::info!("login ok: {} role={} zone={:?}", req.username, role, zone);

    Json(LoginResponse {
        token,
        role: role.to_owned(),
        zone,
        expires_in: jwt::TOKEN_EXPIRY_SECS,
    })
    .into_response()
}

/// POST /api/v1/auth/refresh
/// Validates the existing Bearer token itself (not via middleware).
/// Returns a new token with same sub/role/zone and a fresh expiry.
/// Must be registered on the unprotected router (no JWT middleware layer).
pub async fn refresh_token(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let token_str = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let Some(tok) = token_str else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "missing token"})),
        )
            .into_response();
    };

    let secret = state.jwt_secret.read().await;
    match jwt::validate(tok, &secret) {
        Ok(old) => {
            let new_claims = jwt::Claims::new(&old.sub, &old.role, old.zone);
            match jwt::generate(&new_claims, &secret) {
                Ok(token) => Json(serde_json::json!({
                    "token": token,
                    "expires_in": jwt::TOKEN_EXPIRY_SECS,
                    "role": new_claims.role,
                }))
                .into_response(),
                Err(e) => {
                    tracing::error!("jwt refresh generation failed: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid or expired token"})),
        )
            .into_response(),
    }
}

pub async fn require_auth(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let secret = state.jwt_secret.read().await;
    match token.and_then(|t| jwt::validate(t, &secret).ok()) {
        Some(claims) => {
            drop(secret);
            req.extensions_mut().insert(claims);
            next.run(req).await
        }
        None => (StatusCode::UNAUTHORIZED, "invalid or missing token").into_response(),
    }
}
