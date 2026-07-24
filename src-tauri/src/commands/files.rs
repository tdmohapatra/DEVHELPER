use std::fs;

/// Read a text file, capping the number of bytes returned (for large logs).
/// Returns the tail of the file when it exceeds max_bytes.
#[tauri::command]
pub fn read_text_file(path: String, max_bytes: u64) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Cannot open file: {e}"))?;
    if !meta.is_file() {
        return Err("Path is not a file".into());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
    let slice = if max_bytes > 0 && bytes.len() as u64 > max_bytes {
        &bytes[bytes.len() - max_bytes as usize..]
    } else {
        &bytes[..]
    };
    Ok(String::from_utf8_lossy(slice).to_string())
}
