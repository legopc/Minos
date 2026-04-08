use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use serde_json::json;
use std::time::Duration;
use tokio::time;

use crate::state::SharedState;

/// Handles a new WebSocket connection.
/// - Sends a full state snapshot on connect
/// - Pushes binary Float32Array meter frames at ~20Hz
/// - Accepts control messages from the client (future use)
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: SharedState) {
    // Send full state snapshot immediately on connect
    {
        let params = state.params.read().await;
        let snapshot = json!({
            "op":    "snapshot",
            "state": *params,
        });
        if socket.send(Message::Text(snapshot.to_string())).await.is_err() {
            return;
        }
    }

    let mut meter_tick = time::interval(Duration::from_millis(50)); // ~20 Hz

    loop {
        tokio::select! {
            _ = meter_tick.tick() => {
                // Build binary metering frame: [n_inputs f32s, n_outputs f32s]
                let meters = state.meters.read().await;
                let mut buf: Vec<u8> = Vec::with_capacity(
                    (meters.inputs.len() + meters.outputs.len()) * 4
                );
                for &v in &meters.inputs  { buf.extend_from_slice(&v.to_le_bytes()); }
                for &v in &meters.outputs { buf.extend_from_slice(&v.to_le_bytes()); }
                drop(meters);

                if socket.send(Message::Binary(buf)).await.is_err() {
                    return; // client disconnected
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        // Future: parse control op and update params
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
