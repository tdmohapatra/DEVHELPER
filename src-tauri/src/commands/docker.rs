use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub ports: String,
}

#[derive(Serialize)]
pub struct DockerImage {
    pub repository: String,
    pub tag: String,
    pub id: String,
    pub size: String,
}

fn run_docker(args: &[&str]) -> Result<String, String> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .map_err(|_| "Docker CLI not found. Is Docker installed and on PATH?".to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// List containers (running + stopped) using a tab-delimited format string.
#[tauri::command]
pub fn docker_ps() -> Result<Vec<DockerContainer>, String> {
    let out = run_docker(&[
        "ps",
        "-a",
        "--format",
        "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}",
    ])?;
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let c: Vec<&str> = line.split('\t').collect();
            DockerContainer {
                id: c.first().unwrap_or(&"").to_string(),
                name: c.get(1).unwrap_or(&"").to_string(),
                image: c.get(2).unwrap_or(&"").to_string(),
                status: c.get(3).unwrap_or(&"").to_string(),
                ports: c.get(4).unwrap_or(&"").to_string(),
            }
        })
        .collect())
}

#[tauri::command]
pub fn docker_images() -> Result<Vec<DockerImage>, String> {
    let out = run_docker(&[
        "images",
        "--format",
        "{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}",
    ])?;
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let c: Vec<&str> = line.split('\t').collect();
            DockerImage {
                repository: c.first().unwrap_or(&"").to_string(),
                tag: c.get(1).unwrap_or(&"").to_string(),
                id: c.get(2).unwrap_or(&"").to_string(),
                size: c.get(3).unwrap_or(&"").to_string(),
            }
        })
        .collect())
}

/// action: one of start | stop | restart
#[tauri::command]
pub fn docker_action(action: String, id: String) -> Result<(), String> {
    match action.as_str() {
        "start" | "stop" | "restart" => {
            run_docker(&[action.as_str(), id.as_str()])?;
            Ok(())
        }
        _ => Err(format!("Unsupported action: {action}")),
    }
}

#[tauri::command]
pub fn docker_logs(id: String, tail: u32) -> Result<String, String> {
    run_docker(&["logs", "--tail", &tail.to_string(), &id])
}
