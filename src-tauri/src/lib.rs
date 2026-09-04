mod application_update;
mod commands;
mod diagnostics;
mod error;
mod ffmpeg;
mod history;
mod jobs;
mod open_files;
mod output;
mod power;

use history::HistoryManager;
use jobs::JobManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .default_version_comparator(application_update::is_newer_release)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A file opened while Vidra is already running must join the
            // current selection instead of starting a second instance.
            open_files::store_and_emit(app, open_files::paths_from_args(&argv));
        }))
        .setup(|app| {
            let history_path = app.path().app_data_dir()?.join("conversion-history.json");
            app.manage(HistoryManager::new(history_path));
            // Files passed on launch are stored without emitting: the
            // interface collects them through `take_opened_files` once ready.
            if let Some(opened) = app.try_state::<open_files::OpenedFiles>() {
                opened.push(open_files::paths_from_args(
                    &std::env::args().skip(1).collect::<Vec<_>>(),
                ));
            }
            Ok(())
        })
        .manage(JobManager::default())
        .manage(open_files::OpenedFiles::default())
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
            commands::reveal_output_file,
            commands::list_destination_files,
            commands::save_diagnostic_report,
            open_files::take_opened_files,
            application_update::install_application_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building Vidra");

    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::Opened { urls } => {
                // Finder delivers files opened with a running Vidra as URLs.
                open_files::store_and_emit(app_handle, open_files::paths_from_urls(&urls));
            }
            tauri::RunEvent::ExitRequested { .. } => {
                app_handle.state::<JobManager>().shutdown();
            }
            _ => {}
        }
    });
}
