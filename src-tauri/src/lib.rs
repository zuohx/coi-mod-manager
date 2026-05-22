//! COI Mod Manager — Tauri desktop entry point.
//!
//! All business logic is now implemented in native Rust commands
//! (commands::scan, commands::hub, commands::upgrade).
//! No Node.js dependency required.

use tauri_plugin_opener::OpenerExt;

mod commands;

#[tauri::command]
fn open_mod_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_mod_directory,
            commands::scan::local_scan,
            commands::scan::check_mod,
            commands::scan::stream_scan,
            commands::upgrade::stream_upgrade
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
