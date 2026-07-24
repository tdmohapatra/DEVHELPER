use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct ToolStatus {
    pub name: String,
    pub installed: bool,
    pub version: String,
}

fn probe(name: &str, bin: &str, args: &[&str]) -> ToolStatus {
    match Command::new(bin).args(args).output() {
        Ok(out) if out.status.success() || !out.stdout.is_empty() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let combined = if text.trim().is_empty() { stderr } else { text };
            let version = combined.lines().next().unwrap_or("").trim().to_string();
            ToolStatus { name: name.into(), installed: true, version }
        }
        _ => ToolStatus { name: name.into(), installed: false, version: String::new() },
    }
}

/// Detect common developer tooling and report versions.
#[tauri::command]
pub fn check_environment() -> Vec<ToolStatus> {
    vec![
        probe(".NET", "dotnet", &["--version"]),
        probe("Node.js", "node", &["--version"]),
        probe("Python", "python", &["--version"]),
        probe("Git", "git", &["--version"]),
        probe("Docker", "docker", &["--version"]),
        probe("npm", "npm", &["--version"]),
        probe("Rust", "rustc", &["--version"]),
        probe("Go", "go", &["version"]),
        probe("Java", "java", &["-version"]),
        probe("psql", "psql", &["--version"]),
        probe("redis-cli", "redis-cli", &["--version"]),
        probe("kubectl", "kubectl", &["version", "--client", "--short"]),
    ]
}
