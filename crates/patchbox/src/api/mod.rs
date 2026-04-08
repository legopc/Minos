use axum::Router;
use axum::http::HeaderValue;
use axum::middleware;
use rust_embed::Embed;
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{CorsLayer, AllowOrigin};
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};
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

    // S-03: Rate limiting — global 200 req/s burst, replenish 1 per 50ms.
    // Uses GlobalKeyExtractor (no ConnectInfo needed) — suitable for a
    // controlled environment (pub tablets on LAN, not public internet).
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_millisecond(50)    // 20 req/s sustained globally
            .burst_size(200)        // allow burst (initial page load + all bars)
            .use_headers()
            .key_extractor(tower_governor::key_extractor::GlobalKeyExtractor)
            .finish()
            .unwrap(),
    );
    let governor_limiter = governor_conf.limiter().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        governor_limiter.retain_recent();
    });
    let rate_limit = GovernorLayer { config: Arc::clone(&governor_conf) };

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
        .layer(rate_limit)
        .layer(cors)
}

/// Return the router as a make-service.
/// S-03 uses GlobalKeyExtractor so no ConnectInfo is required.
pub fn make_service(state: SharedState, cfg: Config) -> axum::routing::IntoMakeService<Router> {
    build_router(state, cfg).into_make_service()
}
