use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Serialize)]
pub struct DirEntryInfo {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// Directories never worth walking into when looking for logs or exports.
/// Skipping them here rather than in the UI keeps a scan of a repository root
/// from spending its whole budget inside node_modules.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "bin",
    "obj",
    ".next",
    ".venv",
    "__pycache__",
];

fn walk(
    dir: &Path,
    depth: u32,
    max_depth: u32,
    max_entries: usize,
    out: &mut Vec<DirEntryInfo>,
) -> Result<(), String> {
    if out.len() >= max_entries || depth > max_depth {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))?;

    for entry in entries.flatten() {
        if out.len() >= max_entries {
            return Ok(());
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(meta) = entry.metadata() else { continue };

        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            out.push(DirEntryInfo {
                path: path.to_string_lossy().to_string(),
                name,
                is_dir: true,
                size: 0,
            });
            walk(&path, depth + 1, max_depth, max_entries, out)?;
        } else {
            out.push(DirEntryInfo {
                path: path.to_string_lossy().to_string(),
                name,
                is_dir: false,
                size: meta.len(),
            });
        }
    }
    Ok(())
}

/// List files under a directory, capped in both breadth and depth.
///
/// Both caps are required rather than optional: a scan that walks an entire
/// drive is not a useful default, and a tool that hangs on one is worse than one
/// that returns a partial list and says so.
#[tauri::command]
pub fn list_files(
    root: String,
    max_depth: Option<u32>,
    max_entries: Option<usize>,
) -> Result<Vec<DirEntryInfo>, String> {
    let path = Path::new(&root);
    if !path.exists() {
        return Err(format!("{root} does not exist"));
    }
    if !path.is_dir() {
        return Err(format!("{root} is not a directory"));
    }
    let mut out = Vec::new();
    walk(
        path,
        0,
        max_depth.unwrap_or(4),
        max_entries.unwrap_or(2000),
        &mut out,
    )?;
    Ok(out)
}
