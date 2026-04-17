//! Login endpoint + JWT middleware extractor

use crate::api::ErrorResponse;
use crate::{jwt, pam_auth, state::AppState};
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct LoginResponse {
    pub token: String,
    pub role: String,
    pub zone: Option<String>,
    pub expires_in: u64,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct RefreshTokenResponse {
    pub token: String,
    pub role: String,
    pub zone: Option<String>,
    pub expires_in: u64,
}

/// POST /api/v1/login
#[utoipa::path(
    post,
    path = "/api/v1/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = LoginResponse),
        (status = 401, description = "Invalid credentials", body = ErrorResponse),
        (status = 500, description = "Token error", body = ErrorResponse)
    )
)]
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
            Json(ErrorResponse {
                error: "invalid credentials".to_string(),
                in_memory: None,
            }),
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
                Json(ErrorResponse {
                    error: "token error".to_string(),
                    in_memory: None,
                }),
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
#[utoipa::path(
    post,
    path = "/api/v1/auth/refresh",
    tag = "auth",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Token refreshed", body = RefreshTokenResponse),
        (status = 401, description = "Invalid or missing token", body = ErrorResponse),
        (status = 500, description = "Token error", body = ErrorResponse)
    )
)]
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
            Json(ErrorResponse {
                error: "missing token".to_string(),
                in_memory: None,
            }),
        )
            .into_response();
    };

    let secret = state.jwt_secret.read().await;
    match jwt::validate(tok, &secret) {
        Ok(old) => {
            let zone = old.zone.clone();
            let new_claims = jwt::Claims::new(&old.sub, &old.role, zone.clone());
            match jwt::generate(&new_claims, &secret) {
                Ok(token) => Json(RefreshTokenResponse {
                    token,
                    expires_in: jwt::TOKEN_EXPIRY_SECS,
                    role: new_claims.role,
                    zone,
                })
                .into_response(),
                Err(e) => {
                    tracing::error!("jwt refresh generation failed: {e}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: "token error".to_string(),
                            in_memory: None,
                        }),
                    )
                        .into_response()
                }
            }
        }
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "invalid or expired token".to_string(),
                in_memory: None,
            }),
        )
            .into_response(),
    }
}

#[derive(Serialize)]
struct RbacForbidden {
    error: &'static str,
    required: &'static str,
    actual: &'static str,
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
        None => (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "invalid or missing token".to_string(),
                in_memory: None,
            }),
        )
            .into_response(),
    }
}

pub async fn check_min_role(
    state: AppState,
    min_role: jwt::Role,
    mut req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let secret = state.jwt_secret.read().await;
    match token.and_then(|t| jwt::validate(t, &secret).ok()) {
        Some(claims) => {
            drop(secret);
            let actual = claims.role_level();
            if actual < min_role {
                return (
                    StatusCode::FORBIDDEN,
                    Json(RbacForbidden {
                        error: "insufficient_role",
                        required: min_role.as_str(),
                        actual: actual.as_str(),
                    }),
                )
                    .into_response();
            }
            req.extensions_mut().insert(claims);
            next.run(req).await
        }
        None => (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "invalid or missing token".to_string(),
                in_memory: None,
            }),
        )
            .into_response(),
    }
}
