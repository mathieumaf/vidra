mod audio;
mod video;

use self::{audio::audio_arguments, video::video_arguments};
use super::{validate_input, validate_output, EncodeRequest, MediaInfo, OutputContainer};
use crate::{
    error::{ApiError, ApiResult},
    jobs::PendingJob,
};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

const GLOBAL_ARGUMENTS: [&str; 4] = ["-hide_banner", "-nostdin", "-y", "-i"];

pub(super) fn validate_settings(request: &EncodeRequest, media: &MediaInfo) -> ApiResult<()> {
    video_arguments(
        request.container,
        request.video_codec,
        request.encoding_speed,
        request.quality,
        media.video.as_ref().map(|video| video.codec.as_str()),
    )?;
    audio_arguments(&media.audio, request.container, request.audio_mode)?;
    Ok(())
}

pub(super) fn build_command(
    app: &AppHandle,
    job: &PendingJob,
) -> ApiResult<tauri_plugin_shell::process::Command> {
    validate_settings(&job.request, &job.media)?;
    let input = validate_input(&job.request.input_path)?;
    let output = validate_output(&job.request.output_path, &input, job.request.container)?;
    let mut command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?
        .args(GLOBAL_ARGUMENTS)
        .arg(input.as_os_str())
        .args([
            "-map",
            "0:v:0?",
            "-map",
            "0:a?",
            "-map_metadata",
            "0",
            "-map_chapters",
            "0",
        ])
        .args(video_arguments(
            job.request.container,
            job.request.video_codec,
            job.request.encoding_speed,
            job.request.quality,
            job.media.video.as_ref().map(|video| video.codec.as_str()),
        )?);

    if job.request.container == OutputContainer::Mkv {
        command = command.args(["-map", "0:s?", "-c:s", "copy"]);
    }

    Ok(command
        .args(audio_arguments(
            &job.media.audio,
            job.request.container,
            job.request.audio_mode,
        )?)
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(output.as_os_str())
        .env("AV_LOG_FORCE_NOCOLOR", "1"))
}

#[cfg(test)]
mod tests {
    use super::GLOBAL_ARGUMENTS;

    #[test]
    fn ffmpeg_does_not_read_from_the_controlling_terminal() {
        assert!(GLOBAL_ARGUMENTS.contains(&"-nostdin"));
    }
}
