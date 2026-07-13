mod commands;
mod error;
mod ffmpeg;
mod history;
mod jobs;
mod output;

use history::HistoryManager;
use jobs::JobManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let history_path = app.path().app_data_dir()?.join("conversion-history.json");
            app.manage(HistoryManager::new(history_path));
            Ok(())
        })
        .manage(JobManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_ffmpeg_status,
            commands::probe_media,
            commands::enqueue_encodes,
            commands::start_encode_queue,
            commands::cancel_encode,
            commands::set_encode_paused,
            commands::move_queued_encode,
            commands::list_conversion_history,
            commands::delete_history_entry,
            commands::clear_conversion_history,
            commands::reveal_history_output,
            commands::reveal_output_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vidra");
}
