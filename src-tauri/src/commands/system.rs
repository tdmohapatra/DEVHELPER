use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub os: String,
}

/// Basic app/runtime info surfaced on the dashboard system-status card.
#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "DevHelper".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
    }
}
