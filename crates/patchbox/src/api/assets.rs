use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::Response,
};

use super::WebAssets;

/// Content-Security-Policy for the web UI.
const CSP: &str = "default-src 'self'; \
    script-src 'self'; \
    style-src 'self' https://fonts.googleapis.com; \
    font-src https://fonts.gstatic.com; \
    connect-src 'self' ws: wss:; \
    object-src 'none'";

/// Fallback handler — serves embedded web-ui assets.
/// Requests for `/` resolve to `index.html`.
pub async fn serve_embedded_asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match WebAssets::get(path) {
        Some(asset) => {
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();

            // W-52: long-lived cache for versioned JS/CSS/fonts; no-cache for HTML
            let cache_control = if path.ends_with(".html") {
                "no-cache"
            } else {
                "public, max-age=31536000, immutable"
            };

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::CACHE_CONTROL, cache_control)
                // W-41: CSP header on every asset response
                .header("Content-Security-Policy", CSP)
                .body(Body::from(asset.data))
                .unwrap()
        }
        None => {
            // SPA fallback — serve index.html for unknown paths so the JS
            // router can handle deep links.
            match WebAssets::get("index.html") {
                Some(asset) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .header(header::CACHE_CONTROL, "no-cache")
                    .header("Content-Security-Policy", CSP)
                    .body(Body::from(asset.data))
                    .unwrap(),
                None => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("Not Found"))
                    .unwrap(),
            }
        }
    }
}
