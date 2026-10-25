use super::{
    disk_space, encode, probe, progress::ProgressParser, validate_input, validate_output,
    EncodeFinished, EncodePauseChanged, EncodeRequest, EncodeStarted, ExistingOutput, MediaInfo,
    QueuedEncode,
};
use crate::output::partial::{self, FinalizeRequest};
use crate::{
    diagnostics::{failure_report, BoundedLog, DiagnosticReport},
    error::{ApiError, ApiResult},
    history::{now_millis, HistoryDraft, HistoryEntry, HistoryManager, HistoryStatus},
    jobs::{CancelledJob, DiskSpaceReservation, JobManager, PendingJob, ReservedJob},
};
use std::{
    collections::HashSet,
    future::Future,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

pub async fn enqueue(
    app: AppHandle,
    jobs: &JobManager,
    requests: Vec<EncodeRequest>,
) -> ApiResult<Vec<QueuedEncode>> {
    if requests.is_empty() {
        return Err(empty_requests());
    }
    let ffmpeg_version = super::binary::version(&app, "ffmpeg").await.ok();
    enqueue_prepared(
        jobs,
        requests,
        ffmpeg_version,
        move |path| {
            let app = app.clone();
            async move { probe::media(&app, &path).await }
        },
        ensure_output_space,
    )
    .await
}

fn empty_requests() -> ApiError {
    ApiError::invalid_input("At least one encoding request is required.")
}

fn ensure_output_space(
    prepared: &[(EncodeRequest, MediaInfo)],
    reservations: &[DiskSpaceReservation],
) -> ApiResult<()> {
    disk_space::ensure_available(prepared, reservations)
}

async fn enqueue_prepared<P, F, S>(
    jobs: &JobManager,
    requests: Vec<EncodeRequest>,
    ffmpeg_version: Option<String>,
    mut probe_media: P,
    ensure_space: S,
) -> ApiResult<Vec<QueuedEncode>>
where
    P: FnMut(String) -> F,
    F: Future<Output = ApiResult<MediaInfo>>,
    S: FnOnce(&[(EncodeRequest, MediaInfo)], &[DiskSpaceReservation]) -> ApiResult<()>,
{
    if requests.is_empty() {
        return Err(empty_requests());
    }

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

        let media = probe_media(request.input_path.clone()).await?;
        encode::validate_settings(&request, &media)?;
        request.input_path = input.to_string_lossy().into_owned();
        request.output_path = output.to_string_lossy().into_owned();
        prepared.push((request, media));
    }

    let reservations = jobs.disk_space_reservations()?;
    ensure_space(&prepared, &reservations)?;

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
    with_app_effects(&app, |state, emits| {
        drive_queue(
            state,
            emits,
            |job, partial_output| launch_ffmpeg(&app, job, partial_output),
            |spawned, watched| watch_ffmpeg(&app, spawned, watched),
        )
    })
}

fn launch_ffmpeg(
    app: &AppHandle,
    job: &PendingJob,
    partial_output: &partial::PartialOutput,
) -> Result<SpawnedEncode, LaunchError> {
    let command =
        encode::build_command(app, job, &partial_output.path).map_err(LaunchError::Prepare)?;
    match command.spawn() {
        Ok((receiver, child)) => Ok(SpawnedEncode { receiver, child }),
        Err(error) => Err(LaunchError::Spawn(ApiError::ffmpeg(error.to_string()))),
    }
}

struct SpawnedEncode {
    receiver: tauri::async_runtime::Receiver<CommandEvent>,
    child: CommandChild,
}

fn watch_ffmpeg(app: &AppHandle, spawned: SpawnedEncode, watched: WatchJob) -> ApiResult<()> {
    let SpawnedEncode {
        mut receiver,
        child,
    } = spawned;
    let WatchJob {
        job_id,
        output_path,
        duration_seconds,
        history,
        job,
        partial,
        replace_identity,
    } = watched;
    app.state::<JobManager>().attach_child(&job_id, child)?;
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
    Ok(())
}

enum LaunchError {
    Prepare(ApiError),
    Spawn(ApiError),
}

struct QueueState<'a> {
    jobs: &'a JobManager,
    history: &'a HistoryManager,
    ledger: Option<&'a partial::PartialLedger>,
}

struct Emits<'a> {
    finished: &'a mut dyn FnMut(EncodeFinished),
    pause: &'a mut dyn FnMut(EncodePauseChanged),
    history: &'a mut dyn FnMut(HistoryEntry),
}

fn with_app_effects<R>(
    app: &AppHandle,
    body: impl FnOnce(&QueueState<'_>, &mut Emits<'_>) -> R,
) -> R {
    let jobs = app.state::<JobManager>();
    let history = app.state::<HistoryManager>();
    let ledger = app.try_state::<partial::PartialLedger>();
    let state = QueueState {
        jobs: &jobs,
        history: &history,
        ledger: ledger.as_deref(),
    };
    let mut finished = |event: EncodeFinished| {
        let _ = app.emit("encode-finished", event);
    };
    let mut pause = |event: EncodePauseChanged| {
        let _ = app.emit("encode-pause-changed", event);
    };
    let mut history_event = |entry: HistoryEntry| {
        let _ = app.emit("history-entry-created", entry);
    };
    let mut emits = Emits {
        finished: &mut finished,
        pause: &mut pause,
        history: &mut history_event,
    };
    body(&state, &mut emits)
}

struct PreparedPartial {
    partial: partial::PartialOutput,
    replace_identity: Option<partial::DestinationIdentity>,
}

struct WatchJob {
    job_id: String,
    output_path: String,
    duration_seconds: f64,
    history: HistoryDraft,
    job: Box<PendingJob>,
    partial: partial::PartialOutput,
    replace_identity: Option<partial::DestinationIdentity>,
}

fn drive_queue<L, W, T>(
    state: &QueueState<'_>,
    emits: &mut Emits<'_>,
    mut launch: L,
    mut watch: W,
) -> ApiResult<()>
where
    L: FnMut(&PendingJob, &partial::PartialOutput) -> Result<T, LaunchError>,
    W: FnMut(T, WatchJob) -> ApiResult<()>,
{
    loop {
        let Some(reserved) = state.jobs.reserve_next()? else {
            return Ok(());
        };
        let job = match reserved {
            ReservedJob::Pending(job) => job,
            ReservedJob::Resumed(job_id) => {
                (emits.pause)(EncodePauseChanged {
                    job_id,
                    paused: false,
                });
                return Ok(());
            }
        };
        let job_id = job.id.clone();
        let output_path = job.request.output_path.clone();
        let duration_seconds = job.media.duration_seconds;
        let history = HistoryDraft::from_job(&job, now_millis());

        let prepared = match prepare_partial(state, &job) {
            Ok(prepared) => prepared,
            Err(error) => {
                report_blocked_start(state, emits, job_id, output_path, history, error);
                continue;
            }
        };

        match launch(&job, &prepared.partial) {
            Ok(spawned) => {
                watch(
                    spawned,
                    WatchJob {
                        job_id,
                        output_path,
                        duration_seconds,
                        history,
                        job,
                        partial: prepared.partial,
                        replace_identity: prepared.replace_identity,
                    },
                )?;
                return Ok(());
            }
            Err(LaunchError::Prepare(error)) => {
                rollback_unlaunched_partial(state, &job_id, &prepared.partial);
                report_blocked_start(state, emits, job_id, output_path, history, error);
            }
            Err(LaunchError::Spawn(error)) => {
                release_partial(state, &job_id, &prepared.partial);
                report_spawn_failure(state, emits, &job, job_id, output_path, history, error);
            }
        }
    }
}

fn prepare_partial(state: &QueueState<'_>, job: &PendingJob) -> ApiResult<PreparedPartial> {
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
        &state.jobs.reserved_output_paths()?,
        std::slice::from_ref(&input),
    )?;
    let Some(ledger) = state.ledger else {
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
    if let Err(error) = state.jobs.set_partial(&job.id, partial.clone()) {
        let _ = ledger.forget(&partial);
        partial::discard_partial(&partial);
        return Err(error);
    }
    Ok(PreparedPartial {
        partial,
        replace_identity,
    })
}

fn rollback_unlaunched_partial(
    state: &QueueState<'_>,
    job_id: &str,
    partial_output: &partial::PartialOutput,
) {
    let _ = state.jobs.clear_partial(job_id);
    if let Some(ledger) = state.ledger {
        let _ = ledger.forget(partial_output);
    }
    partial::discard_partial(partial_output);
}

fn release_partial(state: &QueueState<'_>, job_id: &str, partial_output: &partial::PartialOutput) {
    let cleanup = partial::discard_partial(partial_output);
    if cleanup == partial::PartialCleanup::Resolved {
        forget_partial(state, partial_output);
    }
    let _ = state.jobs.clear_partial(job_id);
}

fn release_kept_partial(
    state: &QueueState<'_>,
    partial_output: &partial::PartialOutput,
) -> ApiResult<()> {
    let Some(ledger) = state.ledger else {
        return Err(ApiError::new(
            "output_unavailable",
            "The finished video could not be saved safely.",
        ));
    };
    ledger.release_finished(partial_output)
}

fn forget_partial(state: &QueueState<'_>, partial_output: &partial::PartialOutput) {
    let Some(ledger) = state.ledger else {
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
    with_app_effects(app, |state, emits| finish_with(state, emits, finished));
}

fn finish_with(state: &QueueState<'_>, emits: &mut Emits<'_>, finished: FinishedEncode) {
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
    let _ = state.jobs.finish_active(&job_id);
    let cancelled = state.jobs.take_cancelled(&job_id);
    let outcome = output_outcome(cancelled, exit_code);
    // An empty reservation list would let a numbered fallback take another
    // job's output name. A poisoned queue lock is recovered inside
    // `reserved_output_paths`. Any other failure skips those fallback names.
    let (reserved, reserved_known) = match state.jobs.reserved_output_paths() {
        Ok(paths) => (paths, true),
        Err(error) => {
            eprintln!(
                "Unable to read names reserved by the queue, so a numbered name was not used: {error}"
            );
            (Vec::new(), false)
        }
    };
    let mut finalized = partial::finalize_output(FinalizeRequest {
        partial: &partial_output,
        destination: Path::new(&output_path),
        replace_identity,
        outcome,
        inputs: std::slice::from_ref(&PathBuf::from(&job.request.input_path)),
        reserved: &reserved,
        reserved_known,
    });
    let kept_in_place = finalized.outcome == partial::OutputOutcome::Completed
        && finalized
            .saved_path
            .as_ref()
            .is_some_and(|path| path == &partial_output.path);
    if kept_in_place {
        // Release the claim before reporting the hidden path as saved. If the
        // claim stays unmarked, the next launch deletes that file.
        if let Err(error) = release_kept_partial(state, &partial_output) {
            eprintln!("Unable to record that a finished video was kept: {error}");
            finalized.outcome = partial::OutputOutcome::Failed;
            finalized.error = Some(ApiError::new(
                "output_unavailable",
                "The finished video could not be saved safely.",
            ));
            finalized.saved_path = None;
            finalized.cleanup = partial::PartialCleanup::Retry;
        }
    } else if finalized.cleanup == partial::PartialCleanup::Resolved {
        forget_partial(state, &partial_output);
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
        state,
        emits,
        history,
        history_status,
        error.as_deref(),
        diagnostic.clone(),
    );

    (emits.finished)(EncodeFinished {
        job_id,
        status: status.to_owned(),
        output_path,
        error,
        diagnostic,
    });
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
    state: &QueueState<'_>,
    emits: &mut Emits<'_>,
    job_id: String,
    output_path: String,
    history: HistoryDraft,
    error: ApiError,
) {
    let _ = state.jobs.finish_active(&job_id);
    let diagnostic = output_failure(&error);
    let message = diagnostic.summary.clone();
    record_history(
        state,
        emits,
        history,
        HistoryStatus::Failed,
        Some(&message),
        Some(diagnostic.clone()),
    );
    (emits.finished)(EncodeFinished {
        job_id,
        status: "failed".to_owned(),
        output_path,
        error: Some(message),
        diagnostic: Some(diagnostic),
    });
}

fn report_spawn_failure(
    state: &QueueState<'_>,
    emits: &mut Emits<'_>,
    job: &PendingJob,
    job_id: String,
    output_path: String,
    history: HistoryDraft,
    error: ApiError,
) {
    let mut log = BoundedLog::default();
    log.push(&error.message);
    let diagnostic = failure_report(job, log, None, None);
    let message = diagnostic.summary.clone();
    let _ = state.jobs.finish_active(&job_id);
    record_history(
        state,
        emits,
        history,
        HistoryStatus::Failed,
        Some(&message),
        Some(diagnostic.clone()),
    );
    (emits.finished)(EncodeFinished {
        job_id,
        status: "failed".to_owned(),
        output_path,
        error: Some(message),
        diagnostic: Some(diagnostic),
    });
}

fn record_history(
    state: &QueueState<'_>,
    emits: &mut Emits<'_>,
    draft: HistoryDraft,
    status: HistoryStatus,
    error: Option<&str>,
    diagnostic: Option<DiagnosticReport>,
) {
    match state.history.record(draft, status, error, diagnostic) {
        Ok(entry) => {
            (emits.history)(entry);
        }
        Err(history_error) => {
            eprintln!("Unable to save conversion history: {history_error}");
        }
    }
}

pub fn cancel(app: &AppHandle, jobs: &JobManager, job_id: &str) -> ApiResult<()> {
    cancel_job(jobs, job_id, |finished| {
        app.emit("encode-finished", finished)
            .map_err(|error| ApiError::new("event_error", error.to_string()))
    })
}

fn cancel_job(
    jobs: &JobManager,
    job_id: &str,
    emit_finished: impl FnOnce(EncodeFinished) -> ApiResult<()>,
) -> ApiResult<()> {
    match jobs.cancel(job_id)? {
        CancelledJob::Active { process } => process.stop(),
        CancelledJob::Pending(job) => emit_finished(EncodeFinished {
            job_id: job.id,
            status: "cancelled".to_owned(),
            output_path: job.request.output_path,
            error: None,
            diagnostic: None,
        }),
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
#[path = "queue_tests.rs"]
mod tests;
