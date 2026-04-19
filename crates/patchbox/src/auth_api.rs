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
    // Check config-file users first (if any defined)
    let config_user = {
        let cfg = state.config.read().await;
        cfg.users
            .iter()
            .find(|u| u.username == req.username)
            .cloned()
    };

    let (role, zone) = if let Some(user) = config_user {
        // Config-file user: verify bcrypt password hash
        let password = req.password.clone();
        let hash = user.password_hash.clone();
        let ok = tokio::task::spawn_blocking(move || bcrypt::verify(&password, &hash))
            .await
            .unwrap_or(Ok(false))
            .unwrap_or(false);
        if !ok {
            tracing::warn!("login failed for {} (config user)", req.username);
            return (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "invalid credentials".to_string(),
                    in_memory: None,
                }),
            )
                .into_response();
        }
        (user.role.as_str().to_owned(), None::<String>)
    } else {
        // Fall back to PAM + Linux group role
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
        let username = req.username.clone();
        let (r, z) = tokio::task::spawn_blocking(move || pam_auth::role_for_user(&username))
            .await
            .unwrap_or(("readonly", None));
        (r.to_owned(), z)
    };

    // Issue JWT
    let claims = jwt::Claims::new(&req.username, &role, zone.clone());
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
        role,
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

#[derive(Serialize)]
struct ZoneScopeForbidden {
    error: &'static str,
    zone: String,
    target: Option<String>,
    detail: &'static str,
}

pub fn claimed_zone_id(
    claims: Option<&axum::extract::Extension<crate::jwt::Claims>>,
) -> Option<&str> {
    claims
        .and_then(|axum::extract::Extension(claims)| claims.zone.as_deref())
        .map(str::trim)
        .filter(|zone| !zone.is_empty())
}

pub fn forbid_zone_scope(zone_id: &str, target: Option<&str>, detail: &'static str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(ZoneScopeForbidden {
            error: "zone_scope_forbidden",
            zone: zone_id.to_string(),
            target: target.map(str::to_string),
            detail,
        }),
    )
        .into_response()
}

pub fn ensure_not_zone_scoped(
    claims: Option<&axum::extract::Extension<crate::jwt::Claims>>,
    detail: &'static str,
) -> Result<(), Response> {
    if let Some(zone_id) = claimed_zone_id(claims) {
        return Err(forbid_zone_scope(zone_id, None, detail));
    }
    Ok(())
}

pub fn ensure_zone_scope_target(
    claims: Option<&axum::extract::Extension<crate::jwt::Claims>>,
    target_zone_id: &str,
    detail: &'static str,
) -> Result<(), Response> {
    if let Some(zone_id) = claimed_zone_id(claims) {
        if zone_id != target_zone_id {
            return Err(forbid_zone_scope(zone_id, Some(target_zone_id), detail));
        }
    }
    Ok(())
}

pub fn zone_for_tx(cfg: &patchbox_core::config::PatchboxConfig, tx: usize) -> Option<&str> {
    let tx_id = format!("tx_{tx}");
    cfg.zone_config
        .iter()
        .find(|zone| zone.tx_ids.iter().any(|id| id == &tx_id))
        .map(|zone| zone.id.as_str())
}

pub fn ensure_zone_scope_tx(
    cfg: &patchbox_core::config::PatchboxConfig,
    claims: Option<&axum::extract::Extension<crate::jwt::Claims>>,
    tx: usize,
    detail: &'static str,
) -> Result<(), Response> {
    let Some(zone_id) = claimed_zone_id(claims) else {
        return Ok(());
    };
    let Some(target_zone_id) = zone_for_tx(cfg, tx) else {
        return Err(forbid_zone_scope(zone_id, None, detail));
    };
    ensure_zone_scope_target(claims, target_zone_id, detail)
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
            let min_role = required_role_for(req.method(), req.uri().path());
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

fn required_role_for(method: &axum::http::Method, path: &str) -> jwt::Role {
    use axum::http::Method;
    if method == Method::GET || method == Method::HEAD || method == Method::OPTIONS {
        return jwt::Role::Viewer;
    }
    // Non-GET: system config writes and admin endpoints require Admin
    if path.starts_with("/api/v1/system/") || path.starts_with("/api/v1/admin/") {
        return jwt::Role::Admin;
    }
    // All other writes require Operator
    jwt::Role::Operator
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
