use crate::{
    error::ApiResult,
    ffmpeg::{self, EncodeRequest, FfmpegStatus, MediaInfo},
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
pub async fn start_encode(
    app: AppHandle,
    jobs: State<'_, JobManager>,
    request: EncodeRequest,
) -> ApiResult<String> {
    ffmpeg::encode::start(app, &jobs, request).await
}

#[tauri::command]
pub fn cancel_encode(jobs: State<'_, JobManager>, job_id: String) -> ApiResult<()> {
    ffmpeg::encode::cancel(&jobs, &job_id)
}
