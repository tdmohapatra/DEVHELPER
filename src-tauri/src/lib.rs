mod commands;

use commands::{db, docker, files, network, ports, process, redis, sysprobe, system};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ctrl+Shift+Space brings DevHelper to the front from anywhere.
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &toggle {
                        show_main(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(move |app| {
            // System tray with a quick-actions menu.
            let open = MenuItem::with_id(app, "open", "Open DevHelper", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DevHelper")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Register the global hotkey.
            let _ = app.global_shortcut().register(toggle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ports::check_port,
            ports::kill_process,
            system::app_info,
            docker::docker_ps,
            docker::docker_images,
            docker::docker_action,
            docker::docker_logs,
            process::list_processes,
            process::kill_pid,
            network::tcp_check,
            network::dns_lookup,
            network::ping,
            sysprobe::check_environment,
            files::read_text_file,
            redis::redis_exec,
            db::db_test,
            db::db_query,
            db::db_objects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevHelper");
}
