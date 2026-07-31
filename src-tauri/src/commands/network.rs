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

/// Default connect timeout. Short, because the common use is probing localhost, where a
/// closed port answers immediately and only a firewalled one runs the clock out.
const DEFAULT_TCP_TIMEOUT_MS: u64 = 1500;

/// Attempt a TCP connection to host:port with a timeout.
///
/// Async and off the main thread: a synchronous command blocks Tauri's main thread, which
/// silently serialized concurrent probes — four "parallel" checks took four timeouts.
#[tauri::command]
pub async fn tcp_check(host: String, port: u16, timeout_ms: Option<u64>) -> TcpResult {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TCP_TIMEOUT_MS));
    tauri::async_runtime::spawn_blocking(move || tcp_check_blocking(&host, port, timeout))
        .await
        .unwrap_or(TcpResult { host: String::new(), port, open: false, latency_ms: None })
}

fn tcp_check_blocking(host: &str, port: u16, timeout: Duration) -> TcpResult {
    let addr = format!("{host}:{port}");
    let start = Instant::now();
    let resolved = addr.to_socket_addrs().ok().and_then(|mut it| it.next());
    if let Some(sa) = resolved {
        if TcpStream::connect_timeout(&sa, timeout).is_ok() {
            return TcpResult {
                host: host.to_string(),
                port,
                open: true,
                latency_ms: Some(start.elapsed().as_millis()),
            };
        }
    }
    TcpResult { host: host.to_string(), port, open: false, latency_ms: None }
}

#[cfg(test)]
mod tcp_tests {
    use super::*;

    #[test]
    fn a_closed_local_port_is_reported_shut_and_bounded_by_the_timeout() {
        let timeout = Duration::from_millis(300);
        let start = Instant::now();
        // Port 1 is not something a developer machine listens on. Windows may drop the SYN
        // rather than refuse it, so the timeout — not a fast refusal — is what bounds this.
        let r = tcp_check_blocking("127.0.0.1", 1, timeout);
        assert!(!r.open);
        assert!(r.latency_ms.is_none());
        assert!(start.elapsed() < timeout * 4, "took {:?}", start.elapsed());
    }

    #[test]
    fn an_unresolvable_host_is_reported_shut() {
        let r = tcp_check_blocking("no-such-host.invalid", 80, Duration::from_millis(200));
        assert!(!r.open);
        assert_eq!(r.port, 80);
    }
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
