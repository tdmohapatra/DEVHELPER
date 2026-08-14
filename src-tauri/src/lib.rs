mod commands;

use commands::{
    db, devicelink, docker, files, mssql, nats, network, ports, process, redis, secrets, sysprobe, system,
    toolchain, ws,
};
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
        // Must be registered first: it intercepts the launch of a second copy
        // before that copy sets anything else up. Raising the window we already
        // have is what the user meant by launching it again.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        // Window size and position survive a restart.
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
        // Live WebSocket connections, owned by the Rust side and addressed by id.
        .manage(ws::WsRegistry::default())
        // Live NATS subscriptions, owned by Rust and addressed by id.
        .manage(nats::NatsRegistry::default())
        // Held Redis connections for SUBSCRIBE and MONITOR, which a
        // command-per-call client cannot do.
        .manage(redis::RedisWatchers::default())
        // Live device links: MLLP over TCP and ASTM over a serial port.
        .manage(devicelink::LinkRegistry::default())
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
            redis::redis_watch,
            redis::redis_unwatch,
            redis::redis_watches,
            db::db_test,
            db::db_query,
            db::db_objects,
            mssql::mssql_instances,
            mssql::mssql_instance_port,
            ws::ws_connect,
            ws::ws_send,
            ws::ws_ping,
            ws::ws_close,
            ws::ws_list,
            nats::nats_connect,
            nats::nats_publish,
            nats::nats_request,
            nats::nats_subscribe,
            nats::nats_unsubscribe,
            nats::nats_subscriptions,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            secrets::secret_available,
            devicelink::link_tcp_connect,
            devicelink::link_tcp_listen,
            devicelink::link_serial_ports,
            devicelink::link_serial_open,
            devicelink::link_send,
            devicelink::link_close,
            devicelink::link_list,
            toolchain::toolchain_probe,
            toolchain::toolchain_install,
            toolchain::toolchain_winget_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevHelper");
}
