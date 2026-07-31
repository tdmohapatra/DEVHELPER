//! SQL Server discovery helpers.
//!
//! Connecting to SQL Server is the one engine where "host + port" is rarely what a
//! developer actually has. They have an instance name (`DESKTOP-X\SQLEXPRESS`) whose
//! TCP port is dynamic, and finding it normally means opening SQL Server Configuration
//! Manager. Two mechanisms remove that step:
//!
//!   1. **SQL Browser** — a UDP service on port 1434. One datagram returns every
//!      instance on a host along with its TCP port. Works for remote hosts too, but the
//!      service must be running and UDP 1434 must not be firewalled.
//!   2. **Registry** (local machine only, Windows) — read via `reg query`, so no extra
//!      crate is linked. Used as the fallback when SQL Browser is stopped.

use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MssqlInstance {
    /// Machine name as reported by the server (or the host that was probed).
    pub server: String,
    /// Instance name, e.g. `SQLEXPRESS`. `MSSQLSERVER` is the default instance.
    pub instance: String,
    /// Product version string, when known.
    pub version: Option<String>,
    /// TCP port to connect on. `None` when the instance is configured for named pipes only.
    pub tcp_port: Option<u16>,
    /// How this entry was found: `browser` or `registry`.
    pub source: String,
    /// Local instances only: the registry name of the instance, e.g. `MSSQL17.MSSQLSERVER`.
    /// Fix commands need it, and it cannot be derived from the instance name.
    pub internal_name: Option<String>,
    /// Local instances only: whether the TCP/IP protocol is switched on.
    ///
    /// A running instance with TCP/IP disabled accepts Shared Memory connections (so SSMS
    /// on the same machine works) while refusing every TCP driver. Reporting it turns an
    /// unexplained "connection refused" into a one-line fix.
    pub tcp_enabled: Option<bool>,
}

impl MssqlInstance {
    /// `HOST\INSTANCE`, or just `HOST` for the default instance.
    pub fn display(&self) -> String {
        if self.instance.eq_ignore_ascii_case("MSSQLSERVER") {
            self.server.clone()
        } else {
            format!("{}\\{}", self.server, self.instance)
        }
    }
}

const BROWSER_PORT: u16 = 1434;
const BROWSER_TIMEOUT: Duration = Duration::from_millis(1500);

/// Parse a SQL Browser payload into instances.
///
/// The payload is `key;value;` pairs, with `;;` separating instances:
/// `ServerName;HOST;InstanceName;SQLEXPRESS;IsClustered;No;Version;15.0.2000.5;tcp;1433;;`
pub fn parse_browser_response(payload: &str) -> Vec<MssqlInstance> {
    let mut out = Vec::new();
    for block in payload.split(";;") {
        let parts: Vec<&str> = block.split(';').collect();
        if parts.len() < 2 {
            continue;
        }
        let mut server = String::new();
        let mut instance = String::new();
        let mut version = None;
        let mut tcp_port = None;
        // Walk key/value pairs. `tcp` is the last key and its value is the port.
        let mut i = 0;
        while i + 1 < parts.len() {
            let key = parts[i].trim();
            let value = parts[i + 1].trim();
            match key.to_ascii_lowercase().as_str() {
                "servername" => server = value.to_string(),
                "instancename" => instance = value.to_string(),
                "version" => version = Some(value.to_string()),
                "tcp" => tcp_port = value.parse::<u16>().ok(),
                _ => {}
            }
            i += 2;
        }
        if !server.is_empty() || !instance.is_empty() {
            out.push(MssqlInstance {
                server,
                instance,
                version,
                tcp_port,
                source: "browser".into(),
                internal_name: None,
                tcp_enabled: None,
            });
        }
    }
    out
}

/// Ask a host's SQL Browser for every instance it knows about.
async fn browser_query(host: &str) -> Result<Vec<MssqlInstance>, String> {
    use tokio::net::UdpSocket;

    let socket = UdpSocket::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?;
    socket
        .connect((host, BROWSER_PORT))
        .await
        .map_err(|e| format!("Cannot reach {host}:{BROWSER_PORT}/udp — {e}"))?;

    // 0x03 = CLNT_UCAST_EX: "list every instance on this machine".
    socket.send(&[0x03]).await.map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 8192];
    let n = tokio::time::timeout(BROWSER_TIMEOUT, socket.recv(&mut buf))
        .await
        .map_err(|_| {
            format!("No reply from the SQL Browser on {host} (UDP 1434). The service may be stopped or blocked by a firewall.")
        })?
        .map_err(|e| e.to_string())?;

    // Response: 0x05, then a u16 LE payload length, then ASCII key/value text.
    if n < 3 || buf[0] != 0x05 {
        return Err("Unexpected reply from the SQL Browser".into());
    }
    let len = u16::from_le_bytes([buf[1], buf[2]]) as usize;
    let end = (3 + len).min(n);
    let payload = String::from_utf8_lossy(&buf[3..end]).to_string();

    let mut list = parse_browser_response(&payload);
    // The browser reports its own machine name; keep the host the user typed when it is blank.
    for inst in &mut list {
        if inst.server.is_empty() {
            inst.server = host.to_string();
        }
    }
    Ok(list)
}

/// Parse `reg query` output into (value name, value data) pairs.
fn parse_reg_values(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let name = it.next()?;
            let kind = it.next()?;
            if !kind.starts_with("REG_") {
                return None;
            }
            let data = it.collect::<Vec<_>>().join(" ");
            Some((name.to_string(), data))
        })
        .collect()
}

/// Read a registry value's data with `reg query`, so no registry crate is linked.
#[cfg(windows)]
fn reg_query(key: &str, extra: &[&str]) -> Option<String> {
    use std::process::Command;
    let out = Command::new("reg").arg("query").arg(key).args(extra).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// `Enabled` under the instance's Tcp key: 1 = the TCP/IP protocol is on.
pub fn parse_enabled_flag(output: &str) -> Option<bool> {
    parse_reg_values(output)
        .into_iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("Enabled"))
        .map(|(_, data)| {
            let text = data.trim();
            // REG_DWORD arrives as 0x0 / 0x1.
            text != "0" && !text.eq_ignore_ascii_case("0x0")
        })
}

/// Is TCP/IP switched on for a local instance? `None` when it cannot be determined.
#[cfg(windows)]
fn registry_tcp_enabled(internal_name: &str) -> Option<bool> {
    let key = format!(
        r"HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\{internal_name}\MSSQLServer\SuperSocketNetLib\Tcp"
    );
    parse_enabled_flag(&reg_query(&key, &["/v", "Enabled"])?)
}

#[cfg(not(windows))]
fn registry_tcp_enabled(_internal_name: &str) -> Option<bool> {
    None
}

/// Map instance name → its internal registry name (`MSSQL17.MSSQLSERVER`).
#[cfg(windows)]
fn registry_internal_names() -> Vec<(String, String)> {
    let root = r"HKLM\SOFTWARE\Microsoft\Microsoft SQL Server";
    reg_query(&format!(r"{root}\Instance Names\SQL"), &[])
        .map(|o| parse_reg_values(&o))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn registry_internal_names() -> Vec<(String, String)> {
    Vec::new()
}

/// Registry fallback for the local machine. Returns an empty list on non-Windows.
#[cfg(windows)]
fn registry_instances() -> Vec<MssqlInstance> {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "localhost".into());
    let root = r"HKLM\SOFTWARE\Microsoft\Microsoft SQL Server";

    registry_internal_names()
        .into_iter()
        .map(|(instance, internal)| {
            // Port lives under <internal>\MSSQLServer\SuperSocketNetLib\Tcp\IPAll as either a
            // fixed TcpPort or, for dynamic configurations, TcpDynamicPorts.
            let tcp_key = format!(r"{root}\{internal}\MSSQLServer\SuperSocketNetLib\Tcp\IPAll");
            let port = reg_query(&tcp_key, &["/v", "TcpPort"])
                .and_then(|o| first_port(&o))
                .or_else(|| reg_query(&tcp_key, &["/v", "TcpDynamicPorts"]).and_then(|o| first_port(&o)));
            MssqlInstance {
                server: host.clone(),
                instance,
                version: None,
                tcp_port: port,
                source: "registry".into(),
                tcp_enabled: registry_tcp_enabled(&internal),
                internal_name: Some(internal),
            }
        })
        .collect()
}

#[cfg(not(windows))]
fn registry_instances() -> Vec<MssqlInstance> {
    Vec::new()
}

/// First parsable port in `reg query` output (the value may be a comma-separated list).
fn first_port(output: &str) -> Option<u16> {
    parse_reg_values(output)
        .into_iter()
        .find_map(|(_, data)| data.split(',').next()?.trim().parse::<u16>().ok())
}

/// A host is local when it names this machine rather than a remote server.
fn is_local_host(host: &str) -> bool {
    let h = host.trim().to_ascii_lowercase();
    if h.is_empty() || h == "." || h == "localhost" || h == "127.0.0.1" || h == "(local)" {
        return true;
    }
    std::env::var("COMPUTERNAME")
        .map(|c| c.eq_ignore_ascii_case(&h))
        .unwrap_or(false)
}

/// Add the registry-only facts (TCP/IP enabled) to instances found over the network.
fn enrich_local(mut list: Vec<MssqlInstance>, host: &str) -> Vec<MssqlInstance> {
    if !is_local_host(host) {
        return list;
    }
    let names = registry_internal_names();
    for inst in list.iter_mut() {
        if let Some((_, internal)) = names.iter().find(|(name, _)| name.eq_ignore_ascii_case(&inst.instance)) {
            inst.tcp_enabled = registry_tcp_enabled(internal);
            inst.internal_name = Some(internal.clone());
        }
    }
    list
}

/// List SQL Server instances on `host` (default: this machine).
///
/// Tries the SQL Browser first; falls back to the registry for the local machine so a
/// stopped Browser service is not a dead end.
#[tauri::command]
pub async fn mssql_instances(host: Option<String>) -> Result<Vec<MssqlInstance>, String> {
    let host = host.unwrap_or_else(|| "localhost".into());
    let target = if host.trim().is_empty() { "localhost".to_string() } else { host };

    match browser_query(&target).await {
        Ok(list) if !list.is_empty() => Ok(enrich_local(list, &target)),
        Ok(_) | Err(_) if is_local_host(&target) => {
            let local = registry_instances();
            if local.is_empty() {
                Err("No SQL Server instances found. The SQL Browser service (UDP 1434) is not responding and no instances are registered on this machine.".into())
            } else {
                Ok(local)
            }
        }
        Ok(_) => Err(format!("No SQL Server instances reported by {target}.")),
        Err(e) => Err(e),
    }
}

/// Resolve `host\instance` to a TCP port.
#[tauri::command]
pub async fn mssql_instance_port(host: String, instance: String) -> Result<u16, String> {
    let list = mssql_instances(Some(host.clone())).await?;
    list.iter()
        .find(|i| i.instance.eq_ignore_ascii_case(&instance))
        .and_then(|i| i.tcp_port)
        .ok_or_else(|| {
            let names: Vec<String> = list.iter().map(|i| i.display()).collect();
            if names.is_empty() {
                format!("Instance '{instance}' was not found on {host}.")
            } else {
                format!("Instance '{instance}' was not found on {host}. Available: {}", names.join(", "))
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_single_instance_payload() {
        let payload = "ServerName;DESKTOP-X;InstanceName;SQLEXPRESS;IsClustered;No;Version;15.0.2000.5;tcp;49823;;";
        let list = parse_browser_response(payload);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].server, "DESKTOP-X");
        assert_eq!(list[0].instance, "SQLEXPRESS");
        assert_eq!(list[0].tcp_port, Some(49823));
        assert_eq!(list[0].version.as_deref(), Some("15.0.2000.5"));
        assert_eq!(list[0].display(), "DESKTOP-X\\SQLEXPRESS");
    }

    #[test]
    fn parses_multiple_instances() {
        let payload = "ServerName;HOST;InstanceName;MSSQLSERVER;IsClustered;No;Version;16.0.1000.6;tcp;1433;;\
                       ServerName;HOST;InstanceName;DEV;IsClustered;No;Version;15.0.2000.5;tcp;51000;;";
        let list = parse_browser_response(payload);
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].instance, "DEV");
        assert_eq!(list[1].tcp_port, Some(51000));
        // The default instance is displayed without a suffix.
        assert_eq!(list[0].display(), "HOST");
    }

    #[test]
    fn tolerates_an_instance_without_a_tcp_port() {
        let payload = "ServerName;HOST;InstanceName;PIPESONLY;IsClustered;No;Version;15.0.2000.5;np;\\\\HOST\\pipe\\sql;;";
        let list = parse_browser_response(payload);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tcp_port, None);
    }

    #[test]
    fn ignores_empty_trailing_blocks() {
        assert!(parse_browser_response("").is_empty());
        assert!(parse_browser_response(";;").is_empty());
    }

    #[test]
    fn reads_reg_query_values() {
        let out = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL\r\n    SQLEXPRESS    REG_SZ    MSSQL15.SQLEXPRESS\r\n\r\n";
        let vals = parse_reg_values(out);
        assert_eq!(vals, vec![("SQLEXPRESS".to_string(), "MSSQL15.SQLEXPRESS".to_string())]);
    }

    #[test]
    fn reads_the_first_port_of_a_dynamic_port_list() {
        let out = "    TcpDynamicPorts    REG_SZ    49823,49824\r\n";
        assert_eq!(first_port(out), Some(49823));
        // An empty TcpPort value must not parse as a port.
        assert_eq!(first_port("    TcpPort    REG_SZ    \r\n"), None);
    }

    #[test]
    fn reads_the_tcp_enabled_flag() {
        assert_eq!(parse_enabled_flag("    Enabled    REG_DWORD    0x0\r\n"), Some(false));
        assert_eq!(parse_enabled_flag("    Enabled    REG_DWORD    0x1\r\n"), Some(true));
        // A key without the value tells us nothing.
        assert_eq!(parse_enabled_flag("    TcpPort    REG_SZ    1433\r\n"), None);
    }

    #[test]
    fn recognises_local_host_aliases() {
        assert!(is_local_host("localhost"));
        assert!(is_local_host("."));
        assert!(is_local_host("127.0.0.1"));
        assert!(!is_local_host("db-prod-01"));
    }
}
