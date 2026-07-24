use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::{Duration, Instant};

#[derive(Serialize)]
pub struct TcpResult {
    pub host: String,
    pub port: u16,
    pub open: bool,
    pub latency_ms: Option<u128>,
}

/// Attempt a TCP connection to host:port with a timeout.
#[tauri::command]
pub fn tcp_check(host: String, port: u16) -> TcpResult {
    let addr = format!("{host}:{port}");
    let start = Instant::now();
    let resolved = addr.to_socket_addrs().ok().and_then(|mut it| it.next());
    if let Some(sa) = resolved {
        match TcpStream::connect_timeout(&sa, Duration::from_secs(3)) {
            Ok(_) => {
                return TcpResult { host, port, open: true, latency_ms: Some(start.elapsed().as_millis()) };
            }
            Err(_) => {}
        }
    }
    TcpResult { host, port, open: false, latency_ms: None }
}

#[derive(Serialize)]
pub struct DnsResult {
    pub host: String,
    pub addresses: Vec<String>,
}

/// Resolve a hostname to IP addresses.
#[tauri::command]
pub fn dns_lookup(host: String) -> Result<DnsResult, String> {
    let addrs = format!("{host}:0")
        .to_socket_addrs()
        .map_err(|e| format!("DNS lookup failed: {e}"))?
        .map(|sa| sa.ip().to_string())
        .collect::<Vec<_>>();
    if addrs.is_empty() {
        return Err("No addresses found".into());
    }
    Ok(DnsResult { host, addresses: addrs })
}

/// Ping via the OS `ping` command (count 4). Returns raw output.
#[tauri::command]
pub fn ping(host: String) -> Result<String, String> {
    // Basic guard against argument injection.
    if host.is_empty() || host.contains(|c: char| c.is_whitespace()) {
        return Err("Invalid host".into());
    }
    #[cfg(target_os = "windows")]
    let args = ["-n", "4", host.as_str()];
    #[cfg(not(target_os = "windows"))]
    let args = ["-c", "4", host.as_str()];

    let out = Command::new("ping")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run ping: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
