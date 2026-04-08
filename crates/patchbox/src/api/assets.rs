use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::Response,
};

use super::WebAssets;

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

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
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
