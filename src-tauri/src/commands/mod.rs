use crate::{
    error::ApiResult,
    ffmpeg::{self, EncodeRequest, FfmpegStatus, MediaInfo, QueuedEncode},
    jobs::JobManager,
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
