use crate::{
    diagnostics,
    error::ApiResult,
    ffmpeg::{self, EncodeRequest, FfmpegStatus, MediaInfo, QueuedEncode},
    history::{self, HistoryEntry, HistoryManager},
    jobs::JobManager,
    output,
};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn get_ffmpeg_status(app: AppHandle) -> FfmpegStatus {
    ffmpeg::binary::status(&app).await
}

#[tauri::command]
pub async fn probe_media(app: AppHandle, path: String) -> ApiResult<MediaInfo> {
    ffmpeg::probe::media(&app, &path).await
}

#[tauri::command]
pub async fn enqueue_encodes(
    app: AppHandle,
    jobs: State<'_, JobManager>,
    requests: Vec<EncodeRequest>,
) -> ApiResult<Vec<QueuedEncode>> {
    ffmpeg::queue::enqueue(app, &jobs, requests).await
}

#[tauri::command]
pub fn start_encode_queue(app: AppHandle) -> ApiResult<()> {
    ffmpeg::queue::start_next(app)
}

#[tauri::command]
pub fn cancel_encode(app: AppHandle, jobs: State<'_, JobManager>, job_id: String) -> ApiResult<()> {
    ffmpeg::queue::cancel(&app, &jobs, &job_id)
}

#[tauri::command]
pub fn set_encode_paused(
    app: AppHandle,
    jobs: State<'_, JobManager>,
    job_id: String,
    paused: bool,
) -> ApiResult<()> {
    ffmpeg::queue::set_paused(&app, &jobs, &job_id, paused)
}

#[tauri::command]
pub fn move_queued_encode(
    jobs: State<'_, JobManager>,
    job_id: String,
    direction: i8,
) -> ApiResult<()> {
    ffmpeg::queue::move_pending(&jobs, &job_id, direction)
}

#[tauri::command]
pub fn list_conversion_history(history: State<'_, HistoryManager>) -> ApiResult<Vec<HistoryEntry>> {
    history.list()
}

#[tauri::command]
pub fn delete_history_entry(history: State<'_, HistoryManager>, id: String) -> ApiResult<()> {
    history.delete(&id)
}

#[tauri::command]
pub fn clear_conversion_history(history: State<'_, HistoryManager>) -> ApiResult<()> {
    history.clear()
}

#[tauri::command]
pub fn reveal_history_output(history: State<'_, HistoryManager>, id: String) -> ApiResult<()> {
    history::reveal_output(&history, &id)
}

#[tauri::command]
pub fn reveal_output_file(path: String) -> ApiResult<()> {
    output::reveal(&path)
}

#[tauri::command]
pub fn save_diagnostic_report(path: String, report: String) -> ApiResult<()> {
    diagnostics::save_report(&path, &report)
}
