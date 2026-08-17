//! Byte pipes for medical device links: TCP (MLLP) and serial (ASTM E1381).
//!
//! Deliberately dumb. This module opens a link, moves bytes, and reports what
//! happened; it knows nothing about MLLP framing, ENQ/ACK handshakes, frame
//! numbers or checksums. All of that lives in `src/tools/lib/deviceLink.ts`,
//! where it is a pure state machine with tests against it. A protocol split
//! across two languages is a protocol nobody can test, so the split is here
//! instead: Rust owns the socket, TypeScript owns the conversation.
//!
//! Three kinds of link, one id space:
//! - an outbound TCP connection (talk to an interface engine),
//! - a TCP listener (be the interface engine; each accepted socket gets its own
//!   id, announced with an `accept` event),
//! - a serial port (most analysers are still RS-232, or RS-232 over a converter).
//!
//! Bytes cross to the UI as Latin-1 strings: one char per byte, values 0-255,
//! nothing reinterpreted. HL7 and ASTM are byte protocols with control
//! characters that no text encoding survives intact, and a `String` that has
//! been through UTF-8 validation is no longer the bytes that arrived.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::Notify;

/// Event channel the UI subscribes to. Every event carries the link id.
pub const LINK_EVENT: &str = "devicelink://event";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkEvent {
    pub id: String,
    /// `open` | `accept` | `data` | `close` | `error`
    pub kind: String,
    /// Received bytes as Latin-1, or a human message for the other kinds.
    pub data: String,
    /// Byte count for `data`, zero otherwise.
    pub size: usize,
    /// For `accept`: the listener the connection arrived on.
    pub parent: Option<String>,
    /// For `accept` and `open`: the peer, so the UI can show who connected.
    pub peer: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub name: String,
    /// `usb` | `bluetooth` | `pci` | `unknown` — what the OS says it is.
    pub kind: String,
    /// USB product string when the OS knows one; the cable's own name is often
    /// the only way to tell two identical adapters apart.
    pub product: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    pub id: String,
    /// `tcp` | `listener` | `serial`
    pub kind: String,
    pub label: String,
}

enum Sink {
    /// Outbound bytes for a TCP connection or an accepted socket.
    Bytes(UnboundedSender<Vec<u8>>),
    /// A listener has nothing to write to. It carries the signal that stops its
    /// accept loop — an `AtomicBool` alone cannot, because the loop is parked
    /// inside `accept()` and only looks at the flag when a connection arrives.
    Listener(Arc<Notify>),
    /// Serial writes go through the port handle itself, which is blocking.
    Serial(Arc<Mutex<Box<dyn serialport::SerialPort>>>),
}

struct Link {
    kind: String,
    label: String,
    sink: Sink,
    /// Set on close; every loop checks it so a link never outlives its id.
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct LinkRegistry(Mutex<HashMap<String, Link>>);

fn emit(app: &AppHandle, id: &str, kind: &str, data: impl Into<String>, size: usize) {
    let _ = app.emit(
        LINK_EVENT,
        LinkEvent {
            id: id.to_string(),
            kind: kind.to_string(),
            data: data.into(),
            size,
            parent: None,
            peer: None,
        },
    );
}

fn emit_accept(app: &AppHandle, id: &str, parent: &str, peer: &str) {
    let _ = app.emit(
        LINK_EVENT,
        LinkEvent {
            id: id.to_string(),
            kind: "accept".into(),
            data: format!("Connection from {peer}"),
            size: 0,
            parent: Some(parent.to_string()),
            peer: Some(peer.to_string()),
        },
    );
}

/// Settle a freshly connected socket into the shape a device link needs.
///
/// Two settings, both for the same reason — a link that looks fine and is not.
///
/// Nagle batches small writes, which for MLLP means the `<FS><CR>` that ends a
/// message can sit in the kernel waiting for more data that never comes: the
/// receiver has most of a message and is waiting for the end of it.
///
/// Keepalive is the one that matters over days. Without it, an analyser that is
/// switched off, or a cable pulled, leaves a socket that is open as far as this
/// end is concerned — reads block forever and nothing is reported, because
/// nothing arrived to report. With it, the connection fails and says so.
fn configure_socket(stream: &TcpStream) {
    let _ = stream.set_nodelay(true);
    let keepalive = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(30))
        .with_interval(Duration::from_secs(10));
    let _ = socket2::SockRef::from(stream).set_tcp_keepalive(&keepalive);
}

/// Drop a link from the registry.
///
/// Called when a loop ends rather than only from `link_close`, so a peer that
/// hangs up stops being listed as open and a later send says "not open" instead
/// of succeeding into a channel nobody is reading.
fn forget(app: &AppHandle, id: &str) {
    if let Some(state) = app.try_state::<LinkRegistry>() {
        if let Ok(mut map) = state.0.lock() {
            map.remove(id);
        }
    }
}

/// Bytes → Latin-1 string. One char per byte, no reinterpretation.
fn to_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|b| *b as char).collect()
}

/// Latin-1 string → bytes. A char above U+00FF never came from a byte, so it is
/// an error rather than something to truncate silently into a different message.
fn from_latin1(text: &str) -> Result<Vec<u8>, String> {
    text.chars()
        .map(|c| {
            let n = c as u32;
            if n > 0xff {
                Err(format!(
                    "Character U+{n:04X} cannot be sent as a byte. Encode the message first — a device link carries bytes, not text."
                ))
            } else {
                Ok(n as u8)
            }
        })
        .collect()
}

fn register(registry: &State<'_, LinkRegistry>, id: &str, link: Link) -> Result<(), String> {
    registry
        .0
        .lock()
        .map_err(|_| "Link registry is poisoned".to_string())?
        .insert(id.to_string(), link);
    Ok(())
}

/// Drive one connected socket: a write task draining a channel, a read task emitting events.
fn run_socket(app: AppHandle, id: String, stream: TcpStream, stop: Arc<AtomicBool>) -> UnboundedSender<Vec<u8>> {
    let (tx, mut rx) = unbounded_channel::<Vec<u8>>();
    let (mut read_half, mut write_half) = stream.into_split();

    let write_app = app.clone();
    let write_id = id.clone();
    let write_stop = stop.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if write_stop.load(Ordering::Relaxed) {
                break;
            }
            if let Err(e) = write_half.write_all(&bytes).await {
                emit(&write_app, &write_id, "error", format!("Send failed: {e}"), 0);
                break;
            }
        }
    });

    let read_app = app;
    let read_id = id;
    tauri::async_runtime::spawn(async move {
        let mut buffer = vec![0u8; 8192];
        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            match read_half.read(&mut buffer).await {
                Ok(0) => {
                    emit(&read_app, &read_id, "close", "The peer closed the connection", 0);
                    break;
                }
                Ok(n) => emit(&read_app, &read_id, "data", to_latin1(&buffer[..n]), n),
                Err(e) => {
                    emit(&read_app, &read_id, "error", format!("Read failed: {e}"), 0);
                    break;
                }
            }
        }
        // The socket is finished either way; stop listing it as open.
        forget(&read_app, &read_id);
    });

    tx
}

/// Connect out to an interface engine. Returns the id every later call uses.
#[tauri::command]
pub async fn link_tcp_connect(
    app: AppHandle,
    registry: State<'_, LinkRegistry>,
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let address = format!("{host}:{port}");
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000));

    let stream = tokio::time::timeout(timeout, TcpStream::connect(&address))
        .await
        .map_err(|_| format!("{address} did not answer within {} ms", timeout.as_millis()))?
        .map_err(|e| format!("Could not connect to {address}: {e}"))?;

    configure_socket(&stream);
    let peer = stream.peer_addr().map(|a| a.to_string()).unwrap_or_else(|_| address.clone());

    let id = uuid::Uuid::new_v4().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let tx = run_socket(app.clone(), id.clone(), stream, stop.clone());

    register(
        &registry,
        &id,
        Link { kind: "tcp".into(), label: address.clone(), sink: Sink::Bytes(tx), stop },
    )?;

    let _ = app.emit(
        LINK_EVENT,
        LinkEvent {
            id: id.clone(),
            kind: "open".into(),
            data: format!("Connected to {peer}"),
            size: 0,
            parent: None,
            peer: Some(peer),
        },
    );
    Ok(id)
}

/// Listen for an analyser or engine to connect to us. Each accepted socket gets its own id.
#[tauri::command]
pub async fn link_tcp_listen(
    app: AppHandle,
    registry: State<'_, LinkRegistry>,
    port: u16,
    host: Option<String>,
) -> Result<String, String> {
    let bind = format!("{}:{port}", host.unwrap_or_else(|| "0.0.0.0".into()));
    let listener = TcpListener::bind(&bind)
        .await
        .map_err(|e| format!("Could not listen on {bind}: {e}"))?;

    let id = uuid::Uuid::new_v4().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let shutdown = Arc::new(Notify::new());

    register(
        &registry,
        &id,
        Link {
            kind: "listener".into(),
            label: bind.clone(),
            sink: Sink::Listener(shutdown.clone()),
            stop: stop.clone(),
        },
    )?;

    let accept_app = app.clone();
    let accept_id = id.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            // Selecting on the shutdown signal is what actually releases the
            // port. Checking a flag at the top of the loop cannot: the task is
            // parked inside `accept()` and reaches the check only when a
            // connection arrives, so a "closed" listener stays bound until one
            // does — and rebinding the same port fails with "address in use".
            let accepted = tokio::select! {
                _ = shutdown.notified() => break,
                result = listener.accept() => result,
            };
            match accepted {
                Ok((stream, peer)) => {
                    configure_socket(&stream);
                    let child = uuid::Uuid::new_v4().to_string();
                    let child_stop = Arc::new(AtomicBool::new(false));
                    let tx = run_socket(accept_app.clone(), child.clone(), stream, child_stop.clone());

                    // The accepted socket must be reachable by id before the UI
                    // hears about it, or its first reply has nowhere to go.
                    if let Some(state) = accept_app.try_state::<LinkRegistry>() {
                        if let Ok(mut map) = state.0.lock() {
                            map.insert(
                                child.clone(),
                                Link {
                                    kind: "tcp".into(),
                                    label: peer.to_string(),
                                    sink: Sink::Bytes(tx),
                                    stop: child_stop,
                                },
                            );
                        }
                    }
                    emit_accept(&accept_app, &child, &accept_id, &peer.to_string());
                }
                Err(e) => {
                    emit(&accept_app, &accept_id, "error", format!("Accept failed: {e}"), 0);
                    break;
                }
            }
        }
        // Dropping the listener here is what frees the port; the emit only says so.
        drop(listener);
        forget(&accept_app, &accept_id);
        emit(&accept_app, &accept_id, "close", "Stopped listening", 0);
    });

    emit(&app, &id, "open", format!("Listening on {bind}"), 0);
    Ok(id)
}

/// Every serial port the OS can see.
#[tauri::command]
pub fn link_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| format!("Could not list serial ports: {e}"))?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let (kind, product) = match &p.port_type {
                serialport::SerialPortType::UsbPort(info) => ("usb", info.product.clone()),
                serialport::SerialPortType::BluetoothPort => ("bluetooth", None),
                serialport::SerialPortType::PciPort => ("pci", None),
                serialport::SerialPortType::Unknown => ("unknown", None),
            };
            SerialPortInfo { name: p.port_name, kind: kind.into(), product }
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialSettings {
    pub path: String,
    pub baud: u32,
    /// 5, 6, 7 or 8. Analysers speaking ASTM are very often 7.
    pub data_bits: Option<u8>,
    /// `none` | `odd` | `even`
    pub parity: Option<String>,
    /// 1 or 2
    pub stop_bits: Option<u8>,
    /// `none` | `software` | `hardware`. Most ASTM analysers use none, but a few
    /// assert RTS/CTS and simply never send until it is honoured — which looks
    /// exactly like a dead instrument.
    pub flow_control: Option<String>,
}

/// Open a serial port. Reads run on a blocking thread; the crate has no async API.
#[tauri::command]
pub fn link_serial_open(
    app: AppHandle,
    registry: State<'_, LinkRegistry>,
    settings: SerialSettings,
) -> Result<String, String> {
    let data_bits = match settings.data_bits.unwrap_or(8) {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    };
    let parity = match settings.parity.as_deref().unwrap_or("none") {
        "odd" => serialport::Parity::Odd,
        "even" => serialport::Parity::Even,
        _ => serialport::Parity::None,
    };
    let stop_bits = match settings.stop_bits.unwrap_or(1) {
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    };
    let flow_control = match settings.flow_control.as_deref().unwrap_or("none") {
        "software" => serialport::FlowControl::Software,
        "hardware" => serialport::FlowControl::Hardware,
        _ => serialport::FlowControl::None,
    };

    let port = serialport::new(&settings.path, settings.baud)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .flow_control(flow_control)
        // Short read timeout, not "no timeout": the read loop has to come back
        // regularly to notice that the link was closed.
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|e| format!("Could not open {}: {e}", settings.path))?;

    /*
     * The reader gets its own handle on the same port.
     *
     * Sharing one handle behind a mutex meant every write waited for the read in
     * progress to time out — up to the 200 ms below. ASTM is a handshake: the
     * instrument sends ENQ and expects ACK, and a reply delayed behind an
     * unrelated read is how a link that works on the bench stutters in the lab.
     */
    let mut reader = port
        .try_clone()
        .map_err(|e| format!("Could not open a second handle on {}: {e}", settings.path))?;

    let id = uuid::Uuid::new_v4().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let writer = Arc::new(Mutex::new(port));
    let label = format!("{} @ {}", settings.path, settings.baud);

    register(
        &registry,
        &id,
        Link { kind: "serial".into(), label: label.clone(), sink: Sink::Serial(writer), stop: stop.clone() },
    )?;

    let read_app = app.clone();
    let read_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = vec![0u8; 4096];
        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buffer) {
                Ok(0) => {}
                Ok(n) => emit(&read_app, &read_id, "data", to_latin1(&buffer[..n]), n),
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => {
                    emit(&read_app, &read_id, "error", format!("Read failed: {e}"), 0);
                    break;
                }
            }
        }
        forget(&read_app, &read_id);
        emit(&read_app, &read_id, "close", "Port closed", 0);
    });

    emit(&app, &id, "open", format!("Opened {label}"), 0);
    Ok(id)
}

/// Send bytes exactly as given. Framing and handshakes are the caller's business.
#[tauri::command]
pub fn link_send(registry: State<'_, LinkRegistry>, id: String, data: String) -> Result<usize, String> {
    let bytes = from_latin1(&data)?;
    let map = registry.0.lock().map_err(|_| "Link registry is poisoned".to_string())?;
    let link = map.get(&id).ok_or_else(|| format!("Link {id} is not open"))?;

    match &link.sink {
        Sink::Bytes(tx) => {
            let size = bytes.len();
            tx.send(bytes).map_err(|_| "The link has already closed".to_string())?;
            Ok(size)
        }
        Sink::Serial(port) => {
            let mut guard = port.lock().map_err(|_| "The serial port is poisoned".to_string())?;
            guard.write_all(&bytes).map_err(|e| format!("Write failed: {e}"))?;
            guard.flush().map_err(|e| format!("Flush failed: {e}"))?;
            Ok(bytes.len())
        }
        Sink::Listener(_) => {
            Err("A listener has nothing to send to. Reply on the accepted connection instead.".into())
        }
    }
}

/// Close one link. Closing a listener stops it accepting but leaves live connections alone.
#[tauri::command]
pub fn link_close(registry: State<'_, LinkRegistry>, id: String) -> Result<bool, String> {
    let mut map = registry.0.lock().map_err(|_| "Link registry is poisoned".to_string())?;
    match map.remove(&id) {
        Some(link) => {
            link.stop.store(true, Ordering::Relaxed);
            // `notify_one` leaves a permit behind, so a loop that has not yet
            // reached `notified()` still wakes. `notify_waiters` would drop the
            // signal in exactly that race and leave the port bound.
            if let Sink::Listener(shutdown) = &link.sink {
                shutdown.notify_one();
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Everything currently open, so the UI can recover after a reload.
#[tauri::command]
pub fn link_list(registry: State<'_, LinkRegistry>) -> Result<Vec<LinkInfo>, String> {
    let map = registry.0.lock().map_err(|_| "Link registry is poisoned".to_string())?;
    let mut links: Vec<LinkInfo> = map
        .iter()
        .map(|(id, link)| LinkInfo { id: id.clone(), kind: link.kind.clone(), label: link.label.clone() })
        .collect();
    links.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(links)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latin1_round_trips_every_byte() {
        let bytes: Vec<u8> = (0..=255u8).collect();
        assert_eq!(from_latin1(&to_latin1(&bytes)).unwrap(), bytes);
    }

    #[test]
    fn control_characters_survive() {
        // <VT> … <FS><CR> is an MLLP frame; none of it may be reinterpreted.
        let framed = b"\x0bMSH|^~\\&|\x1c\x0d";
        assert_eq!(from_latin1(&to_latin1(framed)).unwrap(), framed);
    }

    /// The shutdown pattern the accept loop uses actually frees the port.
    ///
    /// Worth a test because the obvious implementation does not. A loop parked in
    /// `accept()` that only checks a flag at the top of each iteration stays
    /// parked, holding the port, until a connection happens to arrive — so a
    /// "closed" listener cannot be rebound and the failure is `address in use`
    /// minutes later, nowhere near the close.
    ///
    /// This exercises the select-and-notify pair in isolation: the command itself
    /// needs an `AppHandle` and a `State`, neither of which exists in a unit test.
    #[tokio::test]
    async fn a_closed_listener_releases_its_port() {
        // Port 0 lets the OS choose, then we ask which it chose.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let shutdown = Arc::new(Notify::new());

        let task_shutdown = shutdown.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = task_shutdown.notified() => break,
                    result = listener.accept() => {
                        if result.is_err() { break; }
                    }
                }
            }
            drop(listener);
        });

        // Nothing ever connects, so the loop is parked exactly where the bug was.
        shutdown.notify_one();
        task.await.unwrap();

        // Rebinding is the only proof that matters.
        TcpListener::bind(("127.0.0.1", port))
            .await
            .expect("the port should be free once the accept loop has stopped");
    }

    #[test]
    fn a_character_that_never_came_from_a_byte_is_refused() {
        let err = from_latin1("naïve — ok, but ✓ is not").unwrap_err();
        assert!(err.contains("cannot be sent as a byte"), "{err}");
    }
}
