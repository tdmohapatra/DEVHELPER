//! A real NATS client, not just the monitoring port.
//!
//! The NATS tool has so far read `/varz`, `/connz` and `/jsz` over HTTP, which
//! is genuinely useful and completely read-only: it can tell you a subject
//! exists and that nobody is subscribed to it, but not what is flowing through
//! it, and it cannot publish a test message. Diagnosing "the consumer is not
//! getting anything" without being able to subscribe means guessing.
//!
//! This is the client protocol on port 4222. Subscriptions are long-lived and
//! owned here, streaming messages to the webview as events, in the same shape
//! the WebSocket tool already uses — one registry keyed by id, one background
//! task per subscription, and an explicit unsubscribe.
//!
//! Deliberately no JetStream publish or consumer management: those change
//! durable server state, and the monitoring view already shows what they did.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

/// Event channel the frontend listens on.
const NATS_EVENT: &str = "nats://message";

#[derive(Clone, Serialize)]
pub struct NatsMessage {
    /// Subscription id this arrived on.
    pub id: String,
    pub subject: String,
    /// Payload as text; binary payloads are described rather than mangled.
    pub payload: String,
    /// True when the payload was not valid UTF-8 and `payload` is a description.
    pub binary: bool,
    pub bytes: usize,
    /// Reply subject, when the publisher expects a response.
    pub reply: Option<String>,
    pub headers: Vec<(String, String)>,
}

#[derive(Clone, Serialize)]
pub struct NatsStatus {
    pub id: String,
    /// "open" | "closed" | "error"
    pub kind: String,
    pub detail: String,
}

#[derive(Deserialize)]
pub struct NatsAuth {
    pub user: Option<String>,
    pub password: Option<String>,
    pub token: Option<String>,
    /// Path to a .creds file, for NGS and other account-based setups.
    pub creds_path: Option<String>,
}

struct Subscription {
    /// Dropping the sender tells the reader task to stop.
    stop: tokio::sync::oneshot::Sender<()>,
    subject: String,
}

#[derive(Default)]
pub struct NatsRegistry {
    subs: Mutex<HashMap<String, Subscription>>,
    /// One connection per server address, shared by every subscription on it.
    clients: tokio::sync::Mutex<HashMap<String, async_nats::Client>>,
}

/// Normalize an address into something `async_nats` accepts.
///
/// Accepts `host`, `host:port` and a full `nats://` URL. A bare host gets 4222,
/// the client port — not 8222, which is the monitoring port the rest of the
/// tool uses and which does not speak this protocol.
pub fn client_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "nats://localhost:4222".into();
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("nats://{trimmed}")
    };
    // Add the default port only when there is no port already.
    let after_scheme = with_scheme.split("://").nth(1).unwrap_or("");
    let host_part = after_scheme.split('/').next().unwrap_or("");
    if host_part.contains(':') {
        with_scheme
    } else {
        format!("{with_scheme}:4222")
    }
}

/// Turn a connect failure into something that names the likely cause.
pub fn friendly_connect_error(url: &str, err: &str) -> String {
    let lower = err.to_lowercase();
    if url.contains(":8222") {
        return format!(
            "{err} — 8222 is the monitoring port and speaks HTTP, not the NATS protocol. The client port is 4222 by default."
        );
    }
    if lower.contains("authorization") || lower.contains("authentication") {
        return format!("{err} — the server refused these credentials. Check the user, token or .creds file.");
    }
    if lower.contains("connection refused") || lower.contains("os error 61") || lower.contains("10061") {
        return format!("{err} — nothing is listening there. Check the address and that the server is running.");
    }
    err.to_string()
}

async fn connect(auth: &Option<NatsAuth>, url: &str) -> Result<async_nats::Client, String> {
    let options = match auth {
        Some(a) if a.creds_path.as_deref().is_some_and(|p| !p.is_empty()) => {
            async_nats::ConnectOptions::with_credentials_file(std::path::PathBuf::from(a.creds_path.clone().unwrap()))
                .await
                .map_err(|e| format!("Could not read the credentials file: {e}"))?
        }
        Some(a) if a.token.as_deref().is_some_and(|t| !t.is_empty()) => {
            async_nats::ConnectOptions::with_token(a.token.clone().unwrap())
        }
        Some(a) if a.user.as_deref().is_some_and(|u| !u.is_empty()) => async_nats::ConnectOptions::with_user_and_password(
            a.user.clone().unwrap_or_default(),
            a.password.clone().unwrap_or_default(),
        ),
        _ => async_nats::ConnectOptions::new(),
    };

    options
        // Bounded so a wrong address reports rather than retrying forever.
        .connection_timeout(Duration::from_secs(5))
        .retry_on_initial_connect()
        .max_reconnects(Some(3))
        .connect(url)
        .await
        .map_err(|e| friendly_connect_error(url, &e.to_string()))
}

impl NatsRegistry {
    /// A connection to this server, reused across subscriptions and publishes.
    async fn client(&self, server: &str, auth: &Option<NatsAuth>) -> Result<async_nats::Client, String> {
        let url = client_url(server);
        let mut clients = self.clients.lock().await;
        if let Some(existing) = clients.get(&url) {
            if existing.connection_state() == async_nats::connection::State::Connected {
                return Ok(existing.clone());
            }
            clients.remove(&url);
        }
        let client = connect(auth, &url).await?;
        clients.insert(url, client.clone());
        Ok(client)
    }
}

fn status(app: &AppHandle, id: &str, kind: &str, detail: impl Into<String>) {
    let _ = app.emit(
        NATS_EVENT,
        NatsStatus { id: id.to_string(), kind: kind.to_string(), detail: detail.into() },
    );
}

/// Check that a server is reachable over the client protocol.
#[tauri::command]
pub async fn nats_connect(
    registry: State<'_, NatsRegistry>,
    server: String,
    auth: Option<NatsAuth>,
) -> Result<String, String> {
    let client = registry.client(&server, &auth).await?;
    Ok(format!("{:?}", client.connection_state()))
}

/// Publish one message. Returns once the server has it.
#[tauri::command]
pub async fn nats_publish(
    registry: State<'_, NatsRegistry>,
    server: String,
    auth: Option<NatsAuth>,
    subject: String,
    payload: String,
    reply: Option<String>,
) -> Result<(), String> {
    let client = registry.client(&server, &auth).await?;
    // `String` already satisfies ToSubject; converting first only makes the
    // generic ambiguous.
    match reply.filter(|r| !r.is_empty()) {
        Some(r) => client
            .publish_with_reply(subject, r, payload.into())
            .await
            .map_err(|e| format!("Publish failed: {e}"))?,
        None => client
            .publish(subject, payload.into())
            .await
            .map_err(|e| format!("Publish failed: {e}"))?,
    }
    // Without a flush, "published" only means "queued locally".
    client.flush().await.map_err(|e| format!("Publish not confirmed: {e}"))?;
    Ok(())
}

/// Send a request and wait for one reply.
#[tauri::command]
pub async fn nats_request(
    registry: State<'_, NatsRegistry>,
    server: String,
    auth: Option<NatsAuth>,
    subject: String,
    payload: String,
    timeout_ms: Option<u64>,
) -> Result<NatsMessage, String> {
    let client = registry.client(&server, &auth).await?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(5000));
    let response = tokio::time::timeout(timeout, client.request(subject, payload.into()))
        .await
        .map_err(|_| {
            format!(
                "No reply within {} ms. Nothing is subscribed to that subject, or the responder did not answer.",
                timeout.as_millis()
            )
        })?
        .map_err(|e| format!("Request failed: {e}"))?;

    Ok(to_message("request", &response))
}

/// Subscribe. Messages arrive as `nats://message` events until unsubscribed.
#[tauri::command]
pub async fn nats_subscribe(
    app: AppHandle,
    registry: State<'_, NatsRegistry>,
    server: String,
    auth: Option<NatsAuth>,
    subject: String,
    queue_group: Option<String>,
) -> Result<String, String> {
    let client = registry.client(&server, &auth).await?;
    let id = format!("sub-{}", uuid_like());

    let mut subscriber = match queue_group.filter(|q| !q.is_empty()) {
        Some(group) => client
            .queue_subscribe(subject.clone(), group)
            .await
            .map_err(|e| format!("Subscribe failed: {e}"))?,
        None => client
            .subscribe(subject.clone())
            .await
            .map_err(|e| format!("Subscribe failed: {e}"))?,
    };

    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    let task_app = app.clone();
    let task_id = id.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                // Unsubscribe wins over a pending message: the user asked to stop.
                _ = &mut stop_rx => break,
                next = subscriber.next() => match next {
                    Some(message) => {
                        let _ = task_app.emit(NATS_EVENT, to_message(&task_id, &message));
                    }
                    None => break,
                },
            }
        }
        let _ = subscriber.unsubscribe().await;
        status(&task_app, &task_id, "closed", "subscription ended");
    });

    registry
        .subs
        .lock()
        .map_err(|_| "Subscription registry is poisoned".to_string())?
        .insert(id.clone(), Subscription { stop: stop_tx, subject: subject.clone() });

    status(&app, &id, "open", format!("subscribed to {subject}"));
    Ok(id)
}

/// Stop one subscription.
#[tauri::command]
pub fn nats_unsubscribe(registry: State<'_, NatsRegistry>, id: String) -> Result<(), String> {
    let sub = registry
        .subs
        .lock()
        .map_err(|_| "Subscription registry is poisoned".to_string())?
        .remove(&id)
        .ok_or_else(|| format!("No subscription {id}"))?;
    // The reader task stops when the sender drops, whether or not this succeeds.
    let _ = sub.stop.send(());
    Ok(())
}

/// Live subscriptions, as (id, subject).
#[tauri::command]
pub fn nats_subscriptions(registry: State<'_, NatsRegistry>) -> Result<Vec<(String, String)>, String> {
    Ok(registry
        .subs
        .lock()
        .map_err(|_| "Subscription registry is poisoned".to_string())?
        .iter()
        .map(|(id, sub)| (id.clone(), sub.subject.clone()))
        .collect())
}

/// Convert a wire message into what the frontend renders.
fn to_message(id: &str, message: &async_nats::Message) -> NatsMessage {
    let bytes = message.payload.len();
    let (payload, binary) = match std::str::from_utf8(&message.payload) {
        Ok(text) => (text.to_string(), false),
        Err(_) => (format!("<{bytes} bytes of binary>"), true),
    };
    let headers = message
        .headers
        .as_ref()
        .map(|h| {
            h.iter()
                .flat_map(|(name, values)| {
                    values.iter().map(move |v| (name.to_string(), v.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    NatsMessage {
        id: id.to_string(),
        subject: message.subject.to_string(),
        payload,
        binary,
        bytes,
        reply: message.reply.as_ref().map(|r| r.to_string()),
        headers,
    }
}

/// Enough uniqueness for a subscription id, without pulling in a uuid crate.
fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{nanos:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_host_gets_the_client_port_not_the_monitoring_port() {
        assert_eq!(client_url("localhost"), "nats://localhost:4222");
        assert_eq!(client_url("nats.internal"), "nats://nats.internal:4222");
    }

    #[test]
    fn an_explicit_port_and_scheme_are_kept() {
        assert_eq!(client_url("localhost:4333"), "nats://localhost:4333");
        assert_eq!(client_url("nats://host:4222"), "nats://host:4222");
        assert_eq!(client_url("tls://host:4443"), "tls://host:4443");
    }

    #[test]
    fn whitespace_and_trailing_slashes_do_not_change_the_target() {
        assert_eq!(client_url("  localhost:4222/  "), "nats://localhost:4222");
    }

    #[test]
    fn an_empty_address_falls_back_to_localhost() {
        assert_eq!(client_url(""), "nats://localhost:4222");
        assert_eq!(client_url("   "), "nats://localhost:4222");
    }

    #[test]
    fn the_monitoring_port_is_named_as_the_mistake_it_is() {
        let msg = friendly_connect_error("nats://localhost:8222", "connection reset");
        assert!(msg.contains("monitoring port"), "{msg}");
        assert!(msg.contains("4222"), "{msg}");
    }

    #[test]
    fn a_refused_connection_says_nothing_is_listening() {
        let msg = friendly_connect_error("nats://localhost:4222", "Connection refused (os error 61)");
        assert!(msg.contains("nothing is listening"), "{msg}");
    }

    #[test]
    fn an_auth_failure_points_at_the_credentials() {
        let msg = friendly_connect_error("nats://localhost:4222", "Authorization Violation");
        assert!(msg.contains("credentials"), "{msg}");
    }

    #[test]
    fn an_unrecognised_error_is_passed_through_unchanged() {
        assert_eq!(friendly_connect_error("nats://h:4222", "something odd"), "something odd");
    }
}
