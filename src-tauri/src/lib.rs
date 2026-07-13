mod commands;
mod error;
mod ffmpeg;
mod jobs;

use jobs::JobManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(JobManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_ffmpeg_status,
            commands::probe_media,
            commands::start_encode,
            commands::cancel_encode
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vidra");
}
