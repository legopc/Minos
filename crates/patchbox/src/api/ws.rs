use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::{header, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::time;

use crate::api::jwt;
use crate::state::SharedState;

/// Maximum simultaneous WebSocket connections (global cap).
const MAX_WS_CONNECTIONS: usize = 20;

#[derive(Deserialize, Default)]
pub struct WsQuery {
    token: Option<String>,
}

/// Handles a new WebSocket connection.
/// - A-05: Validates JWT token if api_keys are configured (token via ?token= or Authorization header)
/// - Validates Origin header against allowed_origins config
/// - Enforces global connection limit (20 max)
/// - Sends a full state snapshot on connect
/// - Pushes binary Float32Array meter frames at ~20Hz with 50ms backpressure timeout
/// - Accepts control messages from the client (future use)
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
    Query(query): Query<WsQuery>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // A-05: JWT auth for WebSocket connections when api_keys are configured.
    if !state.config.api_keys.is_empty() {
        // Accept token from ?token= query param or Authorization: Bearer header
        let token = query.token.as_deref().or_else(|| {
            headers.get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
        });
        match token {
            Some(t) if jwt::validate(t, &state.jwt_secret).is_ok() => { /* ok */ }
            _ => return (StatusCode::UNAUTHORIZED, "WebSocket auth required").into_response(),
        }
    }

    // S-06: Origin validation — if allowed_origins configured, only allow listed origins.
    if !state.config.allowed_origins.is_empty() {
        let origin_ok = headers
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .map(|o| state.config.allowed_origins.iter().any(|a| a == o))
            .unwrap_or(false);
        if !origin_ok {
            return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
        }
    }

    // S-08: Global connection cap.
    let current = state.ws_connections.load(Ordering::Relaxed);
    if current >= MAX_WS_CONNECTIONS {
        return (StatusCode::TOO_MANY_REQUESTS, "Too many WebSocket connections").into_response();
    }

    ws.max_message_size(64 * 1024)
      .on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: SharedState) {
    // Track connection count with RAII-style decrement on exit.
    state.ws_connections.fetch_add(1, Ordering::Relaxed);
    let _guard = WsGuard { state: state.clone() };

    // Send full state snapshot immediately on connect.
    {
        let params = state.params.read().await;
        let snapshot = json!({ "op": "snapshot", "state": *params });
        if timed_send(&mut socket, Message::Text(snapshot.to_string())).await.is_err() {
            return;
        }
    }

    let mut meter_tick = time::interval(Duration::from_millis(50)); // ~20 Hz

    loop {
        tokio::select! {
            _ = meter_tick.tick() => {
                let meters = state.meters.read().await;
                let mut buf: Vec<u8> = Vec::with_capacity(
                    (meters.inputs.len() + meters.outputs.len()) * 4
                );
                for &v in &meters.inputs  { buf.extend_from_slice(&v.to_le_bytes()); }
                for &v in &meters.outputs { buf.extend_from_slice(&v.to_le_bytes()); }
                drop(meters);

                // R-07: Drop slow clients — don't let one lagging tablet stall the loop.
                if timed_send(&mut socket, Message::Binary(buf)).await.is_err() {
                    return;
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        tracing::debug!("ws rx: {}", text);
                    }
                    Some(Ok(Message::Close(_))) | None => return,
                    Some(Err(e)) => {
                        tracing::warn!("ws error: {}", e);
                        return;
                    }
                    _ => {}
                }
            }
        }
    }
}

/// Send a WebSocket message with a 50ms timeout (R-07 backpressure).
/// Returns Err if the send times out or fails — caller should drop the connection.
async fn timed_send(socket: &mut WebSocket, msg: Message) -> Result<(), ()> {
    match tokio::time::timeout(Duration::from_millis(50), socket.send(msg)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err(()),   // send error (client gone)
        Err(_)     => {
            tracing::warn!("ws send timed out — dropping slow client");
            Err(())
        }
    }
}

/// RAII guard that decrements the WS connection counter when dropped.
struct WsGuard { state: SharedState }
impl Drop for WsGuard {
    fn drop(&mut self) {
        self.state.ws_connections.fetch_sub(1, Ordering::Relaxed);
    }
}
