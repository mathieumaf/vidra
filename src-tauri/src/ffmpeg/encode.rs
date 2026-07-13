use super::{
    probe, progress::ProgressParser, validate_input, validate_output, AudioStream, EncodeFinished,
    EncodeRequest,
};
use crate::{
    error::{ApiError, ApiResult},
    jobs::{ActiveJob, JobManager},
};
use std::collections::VecDeque;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const MAX_ERROR_LINES: usize = 8;

fn audio_bitrate_cap(stream: &AudioStream) -> u64 {
    let default_cap = match stream.channels.unwrap_or(2) {
        0 | 1 => 96_000,
        2 => 160_000,
        _ => 256_000,
    };

    stream
        .bit_rate
        .filter(|bit_rate| *bit_rate > 0)
        .unwrap_or(default_cap)
        .min(default_cap)
}

fn add_audio_arguments(
    mut command: tauri_plugin_shell::process::Command,
    streams: &[AudioStream],
) -> tauri_plugin_shell::process::Command {
    for (index, stream) in streams.iter().enumerate() {
        let codec_option = format!("-c:a:{index}");
        if stream.codec.eq_ignore_ascii_case("aac") {
            command = command.args([codec_option, "copy".to_owned()]);
        } else {
            command = command.args([codec_option, "aac".to_owned()]).args([
                format!("-b:a:{index}"),
                audio_bitrate_cap(stream).to_string(),
            ]);
        }
    }

    command
}

pub async fn start(app: AppHandle, jobs: &JobManager, request: EncodeRequest) -> ApiResult<String> {
    let input = validate_input(&request.input_path)?;
    let output = validate_output(&request.output_path, &input)?;
    let media = probe::media(&app, &request.input_path).await?;

    let mut active = jobs
        .active
        .lock()
        .map_err(|_| ApiError::new("job_state_error", "Unable to access the job state."))?;

    if active.is_some() {
        return Err(ApiError::new(
            "encode_in_progress",
            "Another encoding job is already running.",
        ));
    }

    let job_id = jobs.next_id();
    let mut command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?
        .args(["-hide_banner", "-y", "-i"])
        .arg(input.as_os_str())
        .args([
            "-map",
            "0:v:0?",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            request.quality.crf(),
            "-movflags",
            "+faststart",
        ]);

    command = add_audio_arguments(command, &media.audio);
    command = command
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(output.as_os_str())
        .env("AV_LOG_FORCE_NOCOLOR", "1");
    let (mut receiver, child) = command
        .spawn()
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?;

    *active = Some(ActiveJob {
        id: job_id.clone(),
        child,
    });
    drop(active);

    let task_app = app.clone();
    let task_job_id = job_id.clone();
    let output_path = output.to_string_lossy().into_owned();
    let duration_seconds = media.duration_seconds;

    tauri::async_runtime::spawn(async move {
        let mut progress = ProgressParser::default();
        let mut errors = VecDeque::with_capacity(MAX_ERROR_LINES);
        let mut exit_code = None;

        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(payload) = progress.update(&task_job_id, duration_seconds, &line) {
                        let _ = task_app.emit("encode-progress", payload);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if errors.len() == MAX_ERROR_LINES {
                        errors.pop_front();
                    }
                    errors.push_back(String::from_utf8_lossy(&bytes).into_owned());
                }
                CommandEvent::Error(error) => {
                    if errors.len() == MAX_ERROR_LINES {
                        errors.pop_front();
                    }
                    errors.push_back(error);
                }
                CommandEvent::Terminated(payload) => exit_code = payload.code,
                _ => {}
            }
        }

        let manager = task_app.state::<JobManager>();
        if let Ok(mut active) = manager.active.lock() {
            if active.as_ref().map(|job| job.id.as_str()) == Some(task_job_id.as_str()) {
                active.take();
            }
        }

        let cancelled = manager.take_cancelled(&task_job_id);
        let error = (!cancelled && exit_code != Some(0)).then(|| {
            let message = errors.into_iter().collect::<Vec<_>>().join("\n");
            if message.trim().is_empty() {
                format!("FFmpeg exited with code {:?}.", exit_code)
            } else {
                message
            }
        });
        let status = if cancelled {
            "cancelled"
        } else if exit_code == Some(0) {
            "completed"
        } else {
            "failed"
        };

        if status != "completed" {
            let _ = std::fs::remove_file(&output_path);
        }

        let _ = task_app.emit(
            "encode-finished",
            EncodeFinished {
                job_id: task_job_id,
                status: status.to_owned(),
                output_path,
                error,
            },
        );
    });

    Ok(job_id)
}

pub fn cancel(jobs: &JobManager, job_id: &str) -> ApiResult<()> {
    let child = {
        let mut active = jobs
            .active
            .lock()
            .map_err(|_| ApiError::new("job_state_error", "Unable to access the job state."))?;

        match active.as_ref() {
            Some(job) if job.id == job_id => active.take().map(|job| job.child),
            Some(_) => {
                return Err(ApiError::invalid_input(
                    "The requested encoding job is not active.",
                ))
            }
            None => return Err(ApiError::invalid_input("There is no active encoding job.")),
        }
    };

    jobs.mark_cancelled(job_id)?;
    child
        .expect("an active job must own a child process")
        .kill()
        .map_err(|error| ApiError::ffmpeg(format!("Unable to cancel FFmpeg: {error}")))
}

#[cfg(test)]
mod tests {
    use super::audio_bitrate_cap;
    use crate::ffmpeg::{AudioStream, QualityLevel};

    fn audio(codec: &str, channels: u32, bit_rate: Option<u64>) -> AudioStream {
        AudioStream {
            codec: codec.to_owned(),
            channels: Some(channels),
            sample_rate: Some(48_000),
            bit_rate,
            language: None,
        }
    }

    #[test]
    fn never_raises_a_known_audio_bitrate() {
        assert_eq!(audio_bitrate_cap(&audio("opus", 2, Some(96_000))), 96_000);
        assert_eq!(audio_bitrate_cap(&audio("opus", 2, Some(256_000))), 160_000);
    }

    #[test]
    fn uses_channel_aware_caps_when_bitrate_is_unknown() {
        assert_eq!(audio_bitrate_cap(&audio("flac", 1, None)), 96_000);
        assert_eq!(audio_bitrate_cap(&audio("flac", 2, None)), 160_000);
        assert_eq!(audio_bitrate_cap(&audio("flac", 6, None)), 256_000);
    }

    #[test]
    fn quality_levels_map_to_stable_crf_values() {
        assert_eq!(QualityLevel::MaximumCompression.crf(), "30");
        assert_eq!(QualityLevel::Balanced.crf(), "22");
        assert_eq!(QualityLevel::NearSource.crf(), "17");
    }
}
