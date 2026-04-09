//! Login endpoint + JWT middleware extractor

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use crate::{jwt, pam_auth, state::AppState};

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
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "invalid credentials"}))).into_response();
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
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "token error"}))).into_response();
        }
    };

    tracing::info!("login ok: {} role={} zone={:?}", req.username, role, zone);

    Json(LoginResponse {
        token,
        role: role.to_owned(),
        zone,
        expires_in: jwt::TOKEN_EXPIRY_SECS,
    }).into_response()
}

/// Axum middleware: validate Bearer token, inject claims into request extensions.
/// Routes that don't need auth can skip this middleware.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let token = req.headers()
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
        None => {
            (StatusCode::UNAUTHORIZED, "invalid or missing token").into_response()
        }
    }
}
