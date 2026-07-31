//! Native WebSocket client.
//!
//! The webview's own `WebSocket` cannot set handshake headers, so bearer tokens, API keys
//! and cookies are impossible there — which rules out most real APIs. This client runs in
//! Rust instead: it owns the socket, accepts arbitrary headers and subprotocols, and
//! streams frames to the UI as Tauri events.
//!
//! Each connection gets an id. The UI sends by id and listens on one event channel,
//! filtering by id, so several sockets can be open at once.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::Message;

/// Event channel the UI subscribes to. Every frame carries its connection id.
pub const WS_EVENT: &str = "ws://event";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WsEvent {
    pub id: String,
    /// `open` | `message` | `binary` | `ping` | `pong` | `close` | `error`
    pub kind: String,
    /// Text payload, or a description for binary and control frames.
    pub data: String,
    /// Byte length of the frame as it arrived.
    pub size: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsHeader {
    pub name: String,
    pub value: String,
}

/// One live connection: a sender into its write task.
struct WsHandle {
    tx: UnboundedSender<Message>,
}

#[derive(Default)]
pub struct WsRegistry(Mutex<HashMap<String, WsHandle>>);

fn emit(app: &AppHandle, id: &str, kind: &str, data: impl Into<String>, size: usize) {
    let data = data.into();
    let _ = app.emit(
        WS_EVENT,
        WsEvent { id: id.to_string(), kind: kind.to_string(), data, size },
    );
}

/// Open a connection. Returns the id used by every later call.
///
/// `headers` are applied to the HTTP upgrade request, which is the whole point of doing
/// this natively.
#[tauri::command]
pub async fn ws_connect(
    app: AppHandle,
    registry: State<'_, WsRegistry>,
    url: String,
    headers: Option<Vec<WsHeader>>,
    subprotocols: Option<Vec<String>>,
) -> Result<String, String> {
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket URL: {e}"))?;

    {
        let map = request.headers_mut();
        for h in headers.unwrap_or_default() {
            if h.name.trim().is_empty() {
                continue;
            }
            let name = HeaderName::try_from(h.name.trim())
                .map_err(|e| format!("Invalid header name '{}': {e}", h.name))?;
            let value = HeaderValue::from_str(&h.value)
                .map_err(|e| format!("Invalid value for header '{}': {e}", h.name))?;
            map.insert(name, value);
        }
        let protocols = subprotocols.unwrap_or_default();
        if !protocols.is_empty() {
            let joined = protocols.join(", ");
            map.insert(
                "Sec-WebSocket-Protocol",
                HeaderValue::from_str(&joined).map_err(|e| format!("Invalid subprotocol: {e}"))?,
            );
        }
    }

    let (stream, response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| friendly_ws_error(&e.to_string()))?;

    let id = uuid::Uuid::new_v4().to_string();
    let (mut write, mut read) = stream.split();
    let (tx, mut rx) = unbounded_channel::<Message>();

    registry
        .0
        .lock()
        .map_err(|_| "Connection registry is poisoned".to_string())?
        .insert(id.clone(), WsHandle { tx });

    // Write task: drains the channel until the connection is closed.
    let write_app = app.clone();
    let write_id = id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let closing = matches!(msg, Message::Close(_));
            if let Err(e) = write.send(msg).await {
                emit(&write_app, &write_id, "error", format!("Send failed: {e}"), 0);
                break;
            }
            if closing {
                break;
            }
        }
    });

    // Read task: every inbound frame becomes an event.
    let read_app = app.clone();
    let read_id = id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(next) = read.next().await {
            match next {
                Ok(Message::Text(text)) => {
                    let size = text.len();
                    emit(&read_app, &read_id, "message", text, size);
                }
                Ok(Message::Binary(bytes)) => {
                    let size = bytes.len();
                    emit(&read_app, &read_id, "binary", preview_binary(&bytes), size);
                }
                Ok(Message::Ping(p)) => emit(&read_app, &read_id, "ping", "", p.len()),
                Ok(Message::Pong(p)) => emit(&read_app, &read_id, "pong", "", p.len()),
                Ok(Message::Close(frame)) => {
                    let text = frame
                        .map(|f| format!("{} {}", f.code, f.reason))
                        .unwrap_or_else(|| "closed by server".into());
                    emit(&read_app, &read_id, "close", text, 0);
                    break;
                }
                Ok(Message::Frame(_)) => {}
                Err(e) => {
                    emit(&read_app, &read_id, "error", friendly_ws_error(&e.to_string()), 0);
                    break;
                }
            }
        }
        emit(&read_app, &read_id, "close", "connection ended", 0);
    });

    emit(
        &app,
        &id,
        "open",
        format!("HTTP {} — connected", response.status().as_u16()),
        0,
    );
    Ok(id)
}

/// Send a text frame.
#[tauri::command]
pub fn ws_send(registry: State<'_, WsRegistry>, id: String, message: String) -> Result<usize, String> {
    let size = message.len();
    send_message(&registry, &id, Message::Text(message))?;
    Ok(size)
}

/// Send an unsolicited ping — the usual way to check a quiet connection is still alive.
#[tauri::command]
pub fn ws_ping(registry: State<'_, WsRegistry>, id: String) -> Result<(), String> {
    send_message(&registry, &id, Message::Ping(Vec::new()))
}

/// Close a connection and forget it.
#[tauri::command]
pub fn ws_close(registry: State<'_, WsRegistry>, id: String) -> Result<(), String> {
    let handle = registry
        .0
        .lock()
        .map_err(|_| "Connection registry is poisoned".to_string())?
        .remove(&id);
    match handle {
        Some(h) => {
            let _ = h.tx.send(Message::Close(None));
            Ok(())
        }
        None => Err(format!("No open connection with id {id}")),
    }
}

/// Ids of the connections currently open.
#[tauri::command]
pub fn ws_list(registry: State<'_, WsRegistry>) -> Result<Vec<String>, String> {
    Ok(registry
        .0
        .lock()
        .map_err(|_| "Connection registry is poisoned".to_string())?
        .keys()
        .cloned()
        .collect())
}

fn send_message(registry: &State<'_, WsRegistry>, id: &str, msg: Message) -> Result<(), String> {
    let map = registry
        .0
        .lock()
        .map_err(|_| "Connection registry is poisoned".to_string())?;
    let handle = map
        .get(id)
        .ok_or_else(|| format!("No open connection with id {id}"))?;
    handle
        .tx
        .send(msg)
        .map_err(|_| "The connection is closed".to_string())
}

/// Short, readable stand-in for a binary frame.
pub fn preview_binary(bytes: &[u8]) -> String {
    let head: Vec<String> = bytes.iter().take(16).map(|b| format!("{b:02x}")).collect();
    let suffix = if bytes.len() > 16 { "…" } else { "" };
    format!("<{} bytes> {}{}", bytes.len(), head.join(" "), suffix)
}

/// Handshake failures are reported as HTTP status codes with no explanation.
pub fn friendly_ws_error(err: &str) -> String {
    let low = err.to_ascii_lowercase();
    if low.contains("401") || low.contains("unauthorized") {
        return format!("{err}\n\nThe server rejected the handshake as unauthorized. Add the token as a header (for example Authorization: Bearer …) — a browser cannot do this, which is why the header list exists here.");
    }
    if low.contains("403") {
        return format!("{err}\n\nForbidden. Some servers check the Origin header on the upgrade request; try setting Origin to the site the socket belongs to.");
    }
    if low.contains("404") {
        return format!("{err}\n\nThe upgrade path was not found. WebSocket endpoints are usually a specific path such as /ws or /socket.io/?EIO=4&transport=websocket.");
    }
    if low.contains("refused") || low.contains("10061") {
        return format!("{err}\n\nNothing is listening there. Check the port, and that the service is running.");
    }
    if low.contains("certificate") || low.contains("tls") {
        return format!("{err}\n\nThe TLS certificate was rejected. For a self-signed development server, use ws:// or install the certificate into the machine store.");
    }
    if low.contains("http") && low.contains("error") {
        return format!("{err}\n\nThe server answered the upgrade with a plain HTTP response — the URL may be an ordinary endpoint rather than a WebSocket one.");
    }
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_preview_shows_length_and_first_bytes() {
        assert_eq!(preview_binary(&[0x01, 0xff]), "<2 bytes> 01 ff");
    }

    #[test]
    fn binary_preview_truncates_long_frames() {
        let bytes: Vec<u8> = (0..40).collect();
        let out = preview_binary(&bytes);
        assert!(out.starts_with("<40 bytes> 00 01 02"));
        assert!(out.ends_with('…'));
    }

    #[test]
    fn unauthorized_handshakes_explain_the_header_list() {
        let out = friendly_ws_error("HTTP error: 401 Unauthorized");
        assert!(out.contains("Authorization"));
    }

    #[test]
    fn a_missing_path_is_explained() {
        assert!(friendly_ws_error("HTTP error: 404 Not Found").contains("/ws"));
    }

    #[test]
    fn an_unrecognised_error_is_passed_through() {
        assert_eq!(friendly_ws_error("boom"), "boom");
    }
}
