use super::{
    disk_space, encode, probe, progress::ProgressParser, validate_input, validate_output,
    EncodeFinished, EncodePauseChanged, EncodeRequest, EncodeStarted, ExistingOutput, QueuedEncode,
};
use crate::output::partial::{self, FinalizeRequest};
use crate::{
    diagnostics::{failure_report, BoundedLog, DiagnosticReport},
    error::{ApiError, ApiResult},
    history::{now_millis, HistoryDraft, HistoryManager, HistoryStatus},
    jobs::{process, CancelledJob, JobManager, PendingJob, ReservedJob},
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;

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
    let ffmpeg_version = super::binary::version(&app, "ffmpeg").await.ok();
    let inputs = requests
        .iter()
        .map(|request| validate_input(&request.input_path))
        .collect::<ApiResult<Vec<_>>>()?;

    let mut outputs = HashSet::new();
    let mut prepared = Vec::with_capacity(requests.len());

    for (mut request, input) in requests.into_iter().zip(inputs.iter()) {
        let output = validate_output(
            &request.output_path,
            &inputs,
            request.container,
            ExistingOutput::for_request(&request),
        )?;
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

    let reservations = jobs.disk_space_reservations()?;
    disk_space::ensure_available(&prepared, &reservations)?;

    let queued = prepared
        .into_iter()
        .map(|(request, media)| {
            let id = jobs.next_id();
            let snapshot = QueuedEncode {
                job_id: id.clone(),
                input_path: request.input_path.clone(),
                output_path: request.output_path.clone(),
            };
            (
                PendingJob {
                    id,
                    estimated_output_bytes: disk_space::estimated_output_bytes(&request, &media),
                    request,
                    media,
                    ffmpeg_version: ffmpeg_version.clone(),
                },
                snapshot,
            )
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
        let history = HistoryDraft::from_job(&job, now_millis());

        let prepared = match prepare_encode(&app, &manager, &job) {
            Ok(prepared) => prepared,
            Err(error) => {
                report_blocked_start(&app, job_id, output_path, history, error);
                continue;
            }
        };
        let partial = prepared.partial;
        let replace_identity = prepared.replace_identity;

        let (mut receiver, child) = match prepared.command.spawn() {
            Ok(process) => process,
            Err(error) => {
                release_partial(&app, &manager, &job_id, &partial);
                report_spawn_failure(
                    &app,
                    &job,
                    job_id,
                    output_path,
                    history,
                    ApiError::ffmpeg(error.to_string()),
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
            let mut log = BoundedLog::default();
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
                        log.push(&String::from_utf8_lossy(&bytes));
                    }
                    CommandEvent::Error(error) => {
                        log.push(&error);
                    }
                    CommandEvent::Terminated(payload) => exit_code = payload.code,
                    _ => {}
                }
            }

            finish_job(
                &task_app,
                FinishedEncode {
                    job_id,
                    output_path,
                    history,
                    job,
                    partial,
                    replace_identity,
                    log,
                    exit_code,
                },
            );
            let _ = start_next(task_app);
        });

        return Ok(());
    }
}

struct PreparedEncode {
    partial: partial::PartialOutput,
    command: tauri_plugin_shell::process::Command,
    replace_identity: Option<partial::DestinationIdentity>,
}

fn prepare_encode(
    app: &AppHandle,
    jobs: &JobManager,
    job: &PendingJob,
) -> ApiResult<PreparedEncode> {
    let input = validate_input(&job.request.input_path)?;
    let destination = validate_output(
        &job.request.output_path,
        std::slice::from_ref(&input),
        job.request.container,
        ExistingOutput::for_request(&job.request),
    )?;
    // Snapshot replacement before encoding. A destination that was absent is
    // never overwritten, even if a file appears while FFmpeg is running.
    let publish_mode = partial::publish_mode(job.request.replace_existing, &destination);
    let replace_identity = if publish_mode == ExistingOutput::Replace {
        Some(partial::destination_identity(&destination).ok_or_else(|| {
            ApiError::new(
                "output_unavailable",
                "The existing file could not be checked, so it was left unchanged.",
            )
        })?)
    } else {
        None
    };
    let partial = partial::create_partial(
        &destination,
        &job.id,
        job.request.container.extension(),
        &jobs.reserved_output_paths()?,
        std::slice::from_ref(&input),
    )?;
    let Some(ledger) = app.try_state::<partial::PartialLedger>() else {
        partial::discard_partial(&partial);
        return Err(ApiError::new(
            "output_unavailable",
            "The conversion could not be started safely.",
        ));
    };
    if let Err(error) = ledger.record(&partial) {
        partial::discard_partial(&partial);
        return Err(error);
    }
    if let Err(error) = jobs.set_partial(&job.id, partial.clone()) {
        let _ = ledger.forget(&partial);
        partial::discard_partial(&partial);
        return Err(error);
    }
    match encode::build_command(app, job, &partial.path) {
        Ok(command) => Ok(PreparedEncode {
            partial,
            command,
            replace_identity,
        }),
        Err(error) => {
            let _ = jobs.clear_partial(&job.id);
            let _ = ledger.forget(&partial);
            partial::discard_partial(&partial);
            Err(error)
        }
    }
}

fn release_partial(
    app: &AppHandle,
    jobs: &JobManager,
    job_id: &str,
    partial_output: &partial::PartialOutput,
) {
    let cleanup = partial::discard_partial(partial_output);
    if cleanup == partial::PartialCleanup::Resolved {
        forget_partial(app, partial_output);
    }
    let _ = jobs.clear_partial(job_id);
}

fn forget_partial(app: &AppHandle, partial_output: &partial::PartialOutput) {
    let Some(ledger) = app.try_state::<partial::PartialLedger>() else {
        eprintln!("Unable to forget an unfinished video because its list is unavailable.");
        return;
    };
    if let Err(error) = ledger.forget(partial_output) {
        eprintln!("Unable to forget an unfinished video: {error}");
    }
}

fn output_outcome(cancelled: bool, exit_code: Option<i32>) -> partial::OutputOutcome {
    if cancelled {
        partial::OutputOutcome::Cancelled
    } else if exit_code == Some(0) {
        partial::OutputOutcome::Completed
    } else {
        partial::OutputOutcome::Failed
    }
}

struct FinishedEncode {
    job_id: String,
    output_path: String,
    history: HistoryDraft,
    job: Box<PendingJob>,
    partial: partial::PartialOutput,
    replace_identity: Option<partial::DestinationIdentity>,
    log: BoundedLog,
    exit_code: Option<i32>,
}

fn finish_job(app: &AppHandle, finished: FinishedEncode) {
    let FinishedEncode {
        job_id,
        output_path,
        mut history,
        job,
        partial: partial_output,
        replace_identity,
        log,
        exit_code,
    } = finished;
    let manager = app.state::<JobManager>();
    let _ = manager.finish_active(&job_id);
    let cancelled = manager.take_cancelled(&job_id);
    let outcome = output_outcome(cancelled, exit_code);
    let reserved = manager.reserved_output_paths().unwrap_or_default();
    let finalized = partial::finalize_output(FinalizeRequest {
        partial: &partial_output,
        destination: Path::new(&output_path),
        replace_identity,
        outcome,
        inputs: std::slice::from_ref(&PathBuf::from(&job.request.input_path)),
        reserved: &reserved,
    });
    if finalized.cleanup == partial::PartialCleanup::Resolved {
        forget_partial(app, &partial_output);
    }
    if let Some(saved) = finalized.saved_path.as_ref().and_then(|path| path.to_str()) {
        history.output_path = saved.to_owned();
    }

    let partial_text = partial_output.path.to_str();
    let mut diagnostic = (!cancelled && exit_code != Some(0))
        .then(|| failure_report(&job, log, exit_code, partial_text));
    if finalized.outcome != partial::OutputOutcome::Completed {
        if let Some(error) = &finalized.error {
            diagnostic = Some(output_failure(error));
        }
    }
    let error = if finalized.outcome == partial::OutputOutcome::Completed {
        finalized.error.as_ref().map(|error| error.message.clone())
    } else {
        diagnostic.as_ref().map(|report| report.summary.clone())
    };
    let status = match finalized.outcome {
        partial::OutputOutcome::Completed => "completed",
        partial::OutputOutcome::Cancelled => "cancelled",
        partial::OutputOutcome::Failed => "failed",
    };

    let history_status = match status {
        "completed" => HistoryStatus::Completed,
        "cancelled" => HistoryStatus::Cancelled,
        _ => HistoryStatus::Failed,
    };
    let output_path = history.output_path.clone();
    record_history(
        app,
        history,
        history_status,
        error.as_deref(),
        diagnostic.clone(),
    );

    let _ = app.emit(
        "encode-finished",
        EncodeFinished {
            job_id,
            status: status.to_owned(),
            output_path,
            error,
            diagnostic,
        },
    );
}

fn output_failure(error: &ApiError) -> DiagnosticReport {
    let code = &error.code;
    let message = &error.message;
    DiagnosticReport {
        code: error.code.clone(),
        summary: error.message.clone(),
        report: format!(
            "Vidra diagnostic report\n\
             Privacy: source and output paths are redacted.\n\n\
             Failure\n\
             Code: {code}\n\
             Summary: {message}\n"
        ),
    }
}

fn report_blocked_start(
    app: &AppHandle,
    job_id: String,
    output_path: String,
    history: HistoryDraft,
    error: ApiError,
) {
    let manager = app.state::<JobManager>();
    let _ = manager.finish_active(&job_id);
    let diagnostic = output_failure(&error);
    let message = diagnostic.summary.clone();
    record_history(
        app,
        history,
        HistoryStatus::Failed,
        Some(&message),
        Some(diagnostic.clone()),
    );
    let _ = app.emit(
        "encode-finished",
        EncodeFinished {
            job_id,
            status: "failed".to_owned(),
            output_path,
            error: Some(message),
            diagnostic: Some(diagnostic),
        },
    );
}

fn report_spawn_failure(
    app: &AppHandle,
    job: &PendingJob,
    job_id: String,
    output_path: String,
    history: HistoryDraft,
    error: ApiError,
) {
    let manager = app.state::<JobManager>();
    let mut log = BoundedLog::default();
    log.push(&error.message);
    let diagnostic = failure_report(job, log, None, None);
    let message = diagnostic.summary.clone();
    let _ = manager.finish_active(&job_id);
    record_history(
        app,
        history,
        HistoryStatus::Failed,
        Some(&message),
        Some(diagnostic.clone()),
    );
    let _ = app.emit(
        "encode-finished",
        EncodeFinished {
            job_id,
            status: "failed".to_owned(),
            output_path,
            error: Some(message),
            diagnostic: Some(diagnostic),
        },
    );
}

fn record_history(
    app: &AppHandle,
    draft: HistoryDraft,
    status: HistoryStatus,
    error: Option<&str>,
    diagnostic: Option<DiagnosticReport>,
) {
    let manager = app.state::<HistoryManager>();
    match manager.record(draft, status, error, diagnostic) {
        Ok(entry) => {
            let _ = app.emit("history-entry-created", entry);
        }
        Err(history_error) => {
            eprintln!("Unable to save conversion history: {history_error}");
        }
    }
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
                    diagnostic: None,
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

#[cfg(test)]
mod tests {
    use super::output_outcome;
    use crate::output::partial::OutputOutcome;

    #[test]
    fn cancellation_wins_over_a_successful_exit_code() {
        assert_eq!(output_outcome(true, Some(0)), OutputOutcome::Cancelled);
        assert_eq!(output_outcome(true, Some(1)), OutputOutcome::Cancelled);
        assert_eq!(output_outcome(true, None), OutputOutcome::Cancelled);
        assert_eq!(output_outcome(false, Some(0)), OutputOutcome::Completed);
        assert_eq!(output_outcome(false, Some(1)), OutputOutcome::Failed);
        assert_eq!(output_outcome(false, None), OutputOutcome::Failed);
    }
}
