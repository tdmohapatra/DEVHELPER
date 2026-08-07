use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Execute a single Redis command via a minimal RESP client (no external crate).
/// `args` is the full command, e.g. ["GET", "mykey"]. Returns the reply as JSON.
///
/// Each call opens its own connection, so anything that depends on connection
/// state — MULTI, WATCH, SUBSCRIBE — cannot span two calls. `db` is the one piece
/// of that state worth carrying: it is applied with SELECT on this connection
/// before the command runs, so key operations address the database the caller
/// meant rather than always database 0.
#[tauri::command]
pub fn redis_exec(
    host: String,
    port: u16,
    password: Option<String>,
    db: Option<u32>,
    args: Vec<String>,
) -> Result<Value, String> {
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr).map_err(|e| format!("Connect failed: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .map_err(|e| e.to_string())?;
    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);

    if let Some(pw) = password.filter(|p| !p.is_empty()) {
        write_command(&mut writer, &["AUTH".to_string(), pw])?;
        read_reply(&mut reader)?; // consume AUTH reply (errors surface here)
    }

    // SELECT is skipped for database 0: it is already the default, and a server
    // in cluster mode rejects SELECT outright even for 0.
    if let Some(index) = db.filter(|d| *d != 0) {
        write_command(&mut writer, &["SELECT".to_string(), index.to_string()])?;
        read_reply(&mut reader)?;
    }

    write_command(&mut writer, &args)?;
    read_reply(&mut reader)
}

/// Event channel for anything streamed from a held connection.
const REDIS_EVENT: &str = "redis://stream";

#[derive(Clone, Serialize)]
pub struct RedisStreamEvent {
    pub id: String,
    /// "message" | "status" | "error" | "closed"
    pub kind: String,
    /// Channel for pub/sub, or empty for MONITOR and status lines.
    pub channel: String,
    pub payload: String,
}

struct Watch {
    /// Cleared to ask the reader thread to stop at its next line.
    running: Arc<AtomicBool>,
    /// Held so closing it unblocks a reader parked on `read_line`.
    stream: TcpStream,
    describes: String,
}

#[derive(Default)]
pub struct RedisWatchers(Mutex<HashMap<String, Watch>>);

fn emit(app: &AppHandle, id: &str, kind: &str, channel: &str, payload: impl Into<String>) {
    let _ = app.emit(
        REDIS_EVENT,
        RedisStreamEvent {
            id: id.to_string(),
            kind: kind.to_string(),
            channel: channel.to_string(),
            payload: payload.into(),
        },
    );
}

/// Reply values as a flat list of strings, for the shapes pub/sub uses.
fn as_strings(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items.iter().map(flatten).collect(),
        other => vec![flatten(other)],
    }
}

fn flatten(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Turn one streamed reply into the event the frontend renders.
///
/// Pub/sub pushes arrive as arrays whose first element names the kind, while
/// MONITOR pushes bare status lines. Both come down the same socket, so the
/// shape is what tells them apart.
pub fn classify_push(value: &Value) -> (String, String, String) {
    let parts = as_strings(value);
    match parts.first().map(String::as_str) {
        Some("message") if parts.len() >= 3 => ("message".into(), parts[1].clone(), parts[2].clone()),
        Some("pmessage") if parts.len() >= 4 => ("message".into(), parts[2].clone(), parts[3].clone()),
        Some("subscribe") | Some("psubscribe") | Some("unsubscribe") | Some("punsubscribe") => {
            ("status".into(), parts.get(1).cloned().unwrap_or_default(), parts.join(" "))
        }
        _ => ("message".into(), String::new(), parts.join(" ")),
    }
}

/// Open a held connection and stream what it pushes.
///
/// This is the half `redis_exec` cannot do. SUBSCRIBE puts a connection into a
/// mode where it stops answering ordinary commands and only receives pushes,
/// and MONITOR turns it into a firehose of every command the server runs — both
/// only make sense on a connection that stays open, which a command-per-call
/// client does not have.
///
/// MONITOR is worth its warning: the server does extra work per command while
/// anyone is watching, so it is a diagnostic to turn on briefly, not to leave
/// running against production.
#[tauri::command]
pub fn redis_watch(
    app: AppHandle,
    watchers: State<'_, RedisWatchers>,
    host: String,
    port: u16,
    password: Option<String>,
    db: Option<u32>,
    // The full command to hold open, e.g. ["SUBSCRIBE","news"] or ["MONITOR"].
    args: Vec<String>,
) -> Result<String, String> {
    if args.is_empty() {
        return Err("A command is required.".into());
    }
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr).map_err(|e| format!("Connect failed: {e}"))?;
    // No read timeout: this connection is expected to sit idle between pushes.
    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    let keepalive = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);

    if let Some(pw) = password.filter(|p| !p.is_empty()) {
        write_command(&mut writer, &["AUTH".to_string(), pw])?;
        read_reply(&mut reader)?;
    }
    if let Some(index) = db.filter(|d| *d != 0) {
        write_command(&mut writer, &["SELECT".to_string(), index.to_string()])?;
        read_reply(&mut reader)?;
    }
    write_command(&mut writer, &args)?;

    let id = format!("watch-{:x}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0));
    let running = Arc::new(AtomicBool::new(true));

    let thread_app = app.clone();
    let thread_id = id.clone();
    let thread_running = running.clone();
    std::thread::spawn(move || {
        while thread_running.load(Ordering::Relaxed) {
            match read_reply(&mut reader) {
                Ok(value) => {
                    let (kind, channel, payload) = classify_push(&value);
                    emit(&thread_app, &thread_id, &kind, &channel, payload);
                }
                Err(e) => {
                    // A closed socket is how stopping looks from in here, so it
                    // is only an error if nobody asked to stop.
                    if thread_running.load(Ordering::Relaxed) {
                        emit(&thread_app, &thread_id, "error", "", e);
                    }
                    break;
                }
            }
        }
        emit(&thread_app, &thread_id, "closed", "", "connection closed");
    });

    watchers
        .0
        .lock()
        .map_err(|_| "Watch registry is poisoned".to_string())?
        .insert(id.clone(), Watch { running, stream: keepalive, describes: args.join(" ") });

    Ok(id)
}

/// Stop a held connection.
#[tauri::command]
pub fn redis_unwatch(watchers: State<'_, RedisWatchers>, id: String) -> Result<(), String> {
    let watch = watchers
        .0
        .lock()
        .map_err(|_| "Watch registry is poisoned".to_string())?
        .remove(&id)
        .ok_or_else(|| format!("No watch {id}"))?;
    watch.running.store(false, Ordering::Relaxed);
    // The reader is parked inside a blocking read; shutting the socket is what
    // actually wakes it, and the flag above stops that being reported as a fault.
    let _ = watch.stream.shutdown(std::net::Shutdown::Both);
    Ok(())
}

/// Held connections, as (id, what it is watching).
#[tauri::command]
pub fn redis_watches(watchers: State<'_, RedisWatchers>) -> Result<Vec<(String, String)>, String> {
    Ok(watchers
        .0
        .lock()
        .map_err(|_| "Watch registry is poisoned".to_string())?
        .iter()
        .map(|(id, w)| (id.clone(), w.describes.clone()))
        .collect())
}

fn write_command(w: &mut impl Write, args: &[String]) -> Result<(), String> {
    let mut buf = format!("*{}\r\n", args.len());
    for a in args {
        buf.push_str(&format!("${}\r\n{}\r\n", a.len(), a));
    }
    w.write_all(buf.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

fn read_line(r: &mut impl BufRead) -> Result<String, String> {
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| e.to_string())?;
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}

fn read_reply(r: &mut impl BufRead) -> Result<Value, String> {
    let line = read_line(r)?;
    let mut chars = line.chars();
    let prefix = chars.next().ok_or("Empty reply")?;
    let rest: String = chars.collect();

    match prefix {
        '+' => Ok(Value::String(rest)),
        '-' => Err(rest),
        ':' => Ok(Value::from(rest.parse::<i64>().unwrap_or(0))),
        '$' => {
            let len: i64 = rest.parse().map_err(|_| "Bad bulk length")?;
            if len < 0 {
                return Ok(Value::Null);
            }
            let mut buf = vec![0u8; len as usize + 2]; // include trailing CRLF
            r.read_exact(&mut buf).map_err(|e| e.to_string())?;
            buf.truncate(len as usize);
            Ok(Value::String(String::from_utf8_lossy(&buf).to_string()))
        }
        '*' => {
            let n: i64 = rest.parse().map_err(|_| "Bad array length")?;
            if n < 0 {
                return Ok(Value::Null);
            }
            let mut arr = Vec::with_capacity(n as usize);
            for _ in 0..n {
                arr.push(read_reply(r)?);
            }
            Ok(Value::Array(arr))
        }
        other => Err(format!("Unexpected RESP prefix: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_channel_message_carries_its_channel_and_payload() {
        let (kind, channel, payload) = classify_push(&json!(["message", "news", "hello"]));
        assert_eq!((kind.as_str(), channel.as_str(), payload.as_str()), ("message", "news", "hello"));
    }

    #[test]
    fn a_pattern_message_reports_the_channel_it_arrived_on_not_the_pattern() {
        // The pattern is which subscription matched; the channel is where it was
        // actually published, and that is what someone debugging needs.
        let (kind, channel, payload) = classify_push(&json!(["pmessage", "news.*", "news.eu", "hi"]));
        assert_eq!((kind.as_str(), channel.as_str(), payload.as_str()), ("message", "news.eu", "hi"));
    }

    #[test]
    fn subscription_acknowledgements_are_status_not_data() {
        let (kind, channel, _) = classify_push(&json!(["subscribe", "news", 1]));
        assert_eq!(kind, "status");
        assert_eq!(channel, "news");

        assert_eq!(classify_push(&json!(["unsubscribe", "news", 0])).0, "status");
        assert_eq!(classify_push(&json!(["psubscribe", "news.*", 1])).0, "status");
    }

    #[test]
    fn a_monitor_line_has_no_channel_and_is_passed_through() {
        let line = "1700000000.123 [0 127.0.0.1:1] \"GET\" \"key\"";
        let (kind, channel, payload) = classify_push(&json!(line));
        assert_eq!(kind, "message");
        assert_eq!(channel, "");
        assert_eq!(payload, line);
    }

    #[test]
    fn a_truncated_message_does_not_panic() {
        // Fewer elements than the shape needs falls through to the catch-all
        // rather than indexing off the end.
        let (kind, _, payload) = classify_push(&json!(["message", "news"]));
        assert_eq!(kind, "message");
        assert!(payload.contains("news"));
    }

    #[test]
    fn nulls_inside_a_reply_become_empty_strings_rather_than_the_word_null() {
        let (_, _, payload) = classify_push(&json!([Value::Null]));
        assert_eq!(payload, "");
    }
}
