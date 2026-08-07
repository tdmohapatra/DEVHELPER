use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub memory_mb: u64,
    pub exe: Option<String>,
}

/// List processes, optionally filtered by a case-insensitive name substring.
#[tauri::command]
pub fn list_processes(filter: Option<String>) -> Vec<ProcInfo> {
    let mut sys = System::new_all();
    sys.refresh_all();
    let needle = filter.unwrap_or_default().to_lowercase();

    let mut procs: Vec<ProcInfo> = sys
        .processes()
        .values()
        .filter(|p| needle.is_empty() || p.name().to_string_lossy().to_lowercase().contains(&needle))
        .map(|p| ProcInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().to_string(),
            cpu: p.cpu_usage(),
            memory_mb: p.memory() / 1_000_000,
            exe: p.exe().map(|e| e.to_string_lossy().to_string()),
        })
        .collect();

    // Descending, so the heaviest processes are the ones kept by the truncate below.
    procs.sort_by_key(|p| std::cmp::Reverse(p.memory_mb));
    procs.truncate(300);
    procs
}

#[tauri::command]
pub fn kill_pid(pid: u32) -> Result<(), String> {
    let mut sys = System::new_all();
    sys.refresh_all();
    match sys.process(sysinfo::Pid::from_u32(pid)) {
        Some(p) if p.kill() => Ok(()),
        Some(_) => Err(format!("Failed to kill process {pid}")),
        None => Err(format!("No process with PID {pid}")),
    }
}
