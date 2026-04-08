use axum::Router;
use rust_embed::Embed;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use crate::config::Config;
use crate::state::SharedState;

mod routes;
mod ws;
mod assets;

#[derive(Embed)]
#[folder = "../../web-ui/"]
struct WebAssets;

pub fn build_router(state: SharedState, _cfg: Config) -> Router {
    Router::new()
        // REST API
        .nest("/api/v1", routes::api_router(Arc::clone(&state)))
        // WebSocket
        .route("/ws", axum::routing::get(ws::ws_handler))
        // Embedded web UI (serve web-ui/* at /)
        .fallback(assets::serve_embedded_asset)
        .with_state(Arc::clone(&state))
        .layer(CorsLayer::permissive())
}
