use super::{
    encode, probe, progress::ProgressParser, validate_input, validate_output, EncodeFinished,
    EncodePauseChanged, EncodeRequest, EncodeStarted, QueuedEncode,
};
use crate::{
    error::{ApiError, ApiResult},
    jobs::{process, CancelledJob, JobManager, PendingJob, ReservedJob},
};
use std::collections::{HashSet, VecDeque};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;

const MAX_ERROR_LINES: usize = 8;

pub async fn enqueue(
    app: AppHandle,
    jobs: &JobManager,
    requests: Vec<EncodeRequest>,
) -> ApiResult<Vec<QueuedEncode>> {
    if requests.is_empty() {
        return Err(ApiError::invalid_input(
            "At least one encoding request is required.",
        ));
    }

    let mut outputs = HashSet::new();
    let mut prepared = Vec::with_capacity(requests.len());

    for mut request in requests {
        let input = validate_input(&request.input_path)?;
        let output = validate_output(&request.output_path, &input, request.container)?;
        if !outputs.insert(output.clone()) {
            return Err(ApiError::invalid_input(
                "Two queued videos cannot use the same output path.",
            ));
        }

        let media = probe::media(&app, &request.input_path).await?;
        encode::validate_settings(&request, &media)?;
        request.input_path = input.to_string_lossy().into_owned();
        request.output_path = output.to_string_lossy().into_owned();
        prepared.push((request, media));
    }

    let queued = prepared
        .into_iter()
        .map(|(request, media)| {
            let id = jobs.next_id();
            let snapshot = QueuedEncode {
                job_id: id.clone(),
                input_path: request.input_path.clone(),
                output_path: request.output_path.clone(),
            };
            (PendingJob { id, request, media }, snapshot)
        })
        .collect::<Vec<_>>();
    let snapshots = queued
        .iter()
        .map(|(_, snapshot)| snapshot.clone())
        .collect();
    jobs.append(queued.into_iter().map(|(job, _)| job).collect())?;
    Ok(snapshots)
}

pub fn start_next(app: AppHandle) -> ApiResult<()> {
    loop {
        let manager = app.state::<JobManager>();
        let Some(reserved) = manager.reserve_next()? else {
            return Ok(());
        };
        let job = match reserved {
            ReservedJob::Pending(job) => job,
            ReservedJob::Resumed(job_id) => {
                let _ = app.emit(
                    "encode-pause-changed",
                    EncodePauseChanged {
                        job_id,
                        paused: false,
                    },
                );
                return Ok(());
            }
        };
        let job_id = job.id.clone();
        let output_path = job.request.output_path.clone();
        let duration_seconds = job.media.duration_seconds;

        let command = encode::build_command(&app, &job);
        let (mut receiver, child) = match command.and_then(|command| {
            command
                .spawn()
                .map_err(|error| ApiError::ffmpeg(error.to_string()))
        }) {
            Ok(process) => process,
            Err(error) => {
                manager.finish_active(&job_id)?;
                let _ = app.emit(
                    "encode-finished",
                    EncodeFinished {
                        job_id,
                        status: "failed".to_owned(),
                        output_path,
                        error: Some(error.message),
                    },
                );
                continue;
            }
        };

        manager.attach_child(&job_id, child)?;
        let _ = app.emit(
            "encode-started",
            EncodeStarted {
                job_id: job_id.clone(),
            },
        );

        let task_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut progress = ProgressParser::default();
            let mut errors = VecDeque::with_capacity(MAX_ERROR_LINES);
            let mut exit_code = None;

            while let Some(event) = receiver.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        if let Some(payload) = progress.update(&job_id, duration_seconds, &line) {
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

            finish_job(&task_app, job_id, output_path, errors, exit_code);
            let _ = start_next(task_app);
        });

        return Ok(());
    }
}

fn finish_job(
    app: &AppHandle,
    job_id: String,
    output_path: String,
    errors: VecDeque<String>,
    exit_code: Option<i32>,
) {
    let manager = app.state::<JobManager>();
    let _ = manager.finish_active(&job_id);
    let cancelled = manager.take_cancelled(&job_id);
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

    let _ = app.emit(
        "encode-finished",
        EncodeFinished {
            job_id,
            status: status.to_owned(),
            output_path,
            error,
        },
    );
}

pub fn cancel(app: &AppHandle, jobs: &JobManager, job_id: &str) -> ApiResult<()> {
    match jobs.cancel(job_id)? {
        CancelledJob::Active { child, process_id } => process::terminate(process_id, child),
        CancelledJob::Pending(job) => app
            .emit(
                "encode-finished",
                EncodeFinished {
                    job_id: job.id,
                    status: "cancelled".to_owned(),
                    output_path: job.request.output_path,
                    error: None,
                },
            )
            .map_err(|error| ApiError::new("event_error", error.to_string())),
    }
}

pub fn set_paused(app: &AppHandle, jobs: &JobManager, job_id: &str, paused: bool) -> ApiResult<()> {
    jobs.set_paused(job_id, paused)?;
    app.emit(
        "encode-pause-changed",
        EncodePauseChanged {
            job_id: job_id.to_owned(),
            paused,
        },
    )
    .map_err(|error| ApiError::new("event_error", error.to_string()))
}

pub fn move_pending(jobs: &JobManager, job_id: &str, direction: i8) -> ApiResult<()> {
    jobs.move_waiting(job_id, direction)
}
