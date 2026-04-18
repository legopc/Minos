pub mod api;
pub mod auth_api;
pub mod jwt;
pub mod openapi;
pub mod pam_auth;
pub mod ptp;
pub mod scenes;
pub mod state;

/// Apply a minimum-role guard as an Axum route layer.
/// Usage: `.route_layer(require_role!(state, patchbox::jwt::Role::Operator))`
#[macro_export]
macro_rules! require_role {
    ($state:expr, $role:expr) => {
        axum::middleware::from_fn({
            let _st = ($state).clone();
            let _r = $role;
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let s = _st.clone();
                async move { $crate::auth_api::check_min_role(s, _r, req, next).await }
            }
        })
    };
}
