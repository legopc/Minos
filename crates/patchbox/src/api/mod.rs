use axum::Router;
use axum::http::HeaderValue;
use rust_embed::Embed;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, AllowOrigin};

use crate::config::Config;
use crate::state::SharedState;

mod routes;
mod ws;
mod assets;

#[derive(Embed)]
#[folder = "../../web-ui/"]
struct WebAssets;

pub fn build_router(state: SharedState, cfg: Config) -> Router {
    // Build CORS layer — only allow configured origins (empty = same-origin, no CORS headers).
    // For development, add e.g. `allowed_origins = ["http://localhost:9191"]` to config.
    let cors = if cfg.allowed_origins.is_empty() {
        // No extra origins — same-origin requests need no CORS headers.
        CorsLayer::new()
    } else {
        let origins: Vec<HeaderValue> = cfg.allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new().allow_origin(AllowOrigin::list(origins))
    };

    Router::new()
        // REST API
        .nest("/api/v1", routes::api_router(Arc::clone(&state)))
        // WebSocket
        .route("/ws", axum::routing::get(ws::ws_handler))
        // Embedded web UI (serve web-ui/* at /)
        .fallback(assets::serve_embedded_asset)
        .with_state(Arc::clone(&state))
        .layer(cors)
}
