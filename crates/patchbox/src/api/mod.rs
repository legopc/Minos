use axum::Router;
use axum::http::HeaderValue;
use axum::middleware;
use rust_embed::Embed;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, AllowOrigin};

use crate::config::Config;
use crate::state::SharedState;

mod auth;
mod routes;
mod ws;
mod assets;

#[derive(Embed)]
#[folder = "../../web-ui/"]
struct WebAssets;

pub fn build_router(state: SharedState, cfg: Config) -> Router {
    // Build CORS layer
    let cors = if cfg.allowed_origins.is_empty() {
        CorsLayer::new()
    } else {
        let origins: Vec<HeaderValue> = cfg.allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new().allow_origin(AllowOrigin::list(origins))
    };

    // S-01: API key auth middleware applied to /api/v1/* routes only.
    let api_routes = routes::api_router(Arc::clone(&state))
        .route_layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            auth::require_api_key,
        ));

    Router::new()
        .nest("/api/v1", api_routes)
        .route("/ws", axum::routing::get(ws::ws_handler))
        .fallback(assets::serve_embedded_asset)
        .with_state(Arc::clone(&state))
        .layer(cors)
}
