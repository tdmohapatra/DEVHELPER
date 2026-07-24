use serde::Serialize;
use sysinfo::{Pid, System};

#[derive(Serialize)]
pub struct PortInfo {
    pub port: u16,
    pub in_use: bool,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub process_path: Option<String>,
}

/// Check whether a TCP port is in use and, if so, which process owns it.
/// Uses `netstat` on Windows to map the port to a PID, then resolves the
/// process details via sysinfo. All work is local; nothing leaves the machine.
#[tauri::command]
pub fn check_port(port: u16) -> Result<PortInfo, String> {
    let pid = find_pid_for_port(port)?;

    match pid {
        Some(pid_num) => {
            let mut sys = System::new_all();
            sys.refresh_all();
            let (name, path) = sys
                .process(Pid::from_u32(pid_num))
                .map(|p| {
                    (
                        Some(p.name().to_string_lossy().to_string()),
                        p.exe().map(|e| e.to_string_lossy().to_string()),
                    )
                })
                .unwrap_or((None, None));

            Ok(PortInfo {
                port,
                in_use: true,
                pid: Some(pid_num),
                process_name: name,
                process_path: path,
            })
        }
        None => Ok(PortInfo {
            port,
            in_use: false,
            pid: None,
            process_name: None,
            process_path: None,
        }),
    }
}

/// Kill a process by PID. Destructive — the caller (frontend) must confirm first.
#[tauri::command]
pub fn kill_process(pid: u32) -> Result<(), String> {
    let mut sys = System::new_all();
    sys.refresh_all();
    match sys.process(Pid::from_u32(pid)) {
        Some(process) => {
            if process.kill() {
                Ok(())
            } else {
                Err(format!("Failed to kill process {pid}"))
            }
        }
        None => Err(format!("No process found with PID {pid}")),
    }
}

#[cfg(target_os = "windows")]
fn find_pid_for_port(port: u16) -> Result<Option<u32>, String> {
    use std::process::Command;

    let output = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
        .map_err(|e| format!("Failed to run netstat: {e}"))?;

    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");

    for line in text.lines() {
        // Columns: Proto  Local Address  Foreign Address  State  PID
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 {
            continue;
        }
        let local = cols[1];
        // Match the local address port exactly (avoid substring false positives).
        if let Some(idx) = local.rfind(':') {
            if &local[idx..] == needle && cols[3] == "LISTENING" {
                if let Ok(pid) = cols[4].parse::<u32>() {
                    return Ok(Some(pid));
                }
            }
        }
    }
    Ok(None)
}

#[cfg(not(target_os = "windows"))]
fn find_pid_for_port(_port: u16) -> Result<Option<u32>, String> {
    Err("Port checking is currently implemented for Windows only".into())
}
