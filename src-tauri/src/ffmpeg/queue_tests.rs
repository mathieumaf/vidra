use super::{
    cancel_job, drive_queue, enqueue_prepared, ensure_output_space, finish_with, move_pending,
    output_outcome, Emits, FinishedEncode, LaunchError, QueueState,
};
use crate::{
    diagnostics::BoundedLog,
    error::ApiError,
    ffmpeg::{
        AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodeRequest, EncodingSpeed,
        MediaInfo, OutputContainer, OutputFrameRate, OutputResolution, QualityLevel, VideoCodec,
    },
    history::{HistoryManager, HistoryStatus},
    jobs::{process::RunningProcess, JobManager, ReservedJob},
    output::partial::{self, OutputOutcome, PartialLedger},
};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock should be after the epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vidra-queue-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("the test directory should be created");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_source(directory: &Path, name: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, b"source-media").expect("the source file should be written");
    path
}

fn request(input: &Path, output: &Path) -> EncodeRequest {
    EncodeRequest {
        input_path: input.to_string_lossy().into_owned(),
        output_path: output.to_string_lossy().into_owned(),
        quality: QualityLevel::Balanced,
        container: OutputContainer::Mp4,
        video_codec: VideoCodec::H264,
        encoding_speed: EncodingSpeed::Efficient,
        audio_mode: AudioMode::Auto,
        output_resolution: OutputResolution::Source,
        output_frame_rate: OutputFrameRate::Source,
        quality_tuning: 0,
        audio_bitrate: AudioBitrate::Auto,
        audio_channels: AudioChannels::Source,
        audio_track_mode: AudioTrackMode::All,
        audio_stream_indexes: vec![],
        subtitle_stream_indexes: vec![],
        preserve_subtitles: true,
        preserve_metadata: true,
        preserve_chapters: true,
        replace_existing: false,
        allow_insufficient_disk_space: false,
    }
}

fn media_info(input: &Path) -> MediaInfo {
    MediaInfo {
        path: input.to_string_lossy().into_owned(),
        name: input
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("clip.mov")
            .to_owned(),
        duration_seconds: 12.0,
        size_bytes: 2_048,
        format_name: "mov".to_owned(),
        format_long_name: Some("QuickTime".to_owned()),
        video: None,
        audio: vec![],
        subtitles: vec![],
        chapter_count: 0,
        has_metadata: false,
    }
}

fn pending_job(id: &str, input: &Path, output: &Path) -> crate::jobs::PendingJob {
    crate::jobs::PendingJob {
        id: id.to_owned(),
        estimated_output_bytes: 1_024,
        request: request(input, output),
        media: media_info(input),
        ffmpeg_version: Some("ffmpeg test".to_owned()),
    }
}

struct EnqueueTrace {
    steps: Vec<String>,
    result: Result<Vec<crate::ffmpeg::QueuedEncode>, ApiError>,
}

fn trace_enqueue(
    jobs: &JobManager,
    requests: Vec<EncodeRequest>,
    mut probe: impl FnMut(&str) -> Result<MediaInfo, ApiError>,
    mut space: impl FnMut(
        &[(EncodeRequest, MediaInfo)],
        &[crate::jobs::DiskSpaceReservation],
    ) -> Result<(), ApiError>,
) -> EnqueueTrace {
    let steps = RefCell::new(Vec::new());
    let result = block_on(enqueue_prepared(
        jobs,
        requests,
        Some("ffmpeg test".to_owned()),
        |path| {
            steps.borrow_mut().push(format!("probe {path}"));
            std::future::ready(probe(&path))
        },
        |prepared, reservations| {
            steps.borrow_mut().push("disk".to_owned());
            space(prepared, reservations)
        },
    ));
    EnqueueTrace {
        steps: steps.into_inner(),
        result,
    }
}

fn partial_names(directory: &Path) -> Vec<String> {
    fs::read_dir(directory)
        .expect("the test directory should be readable")
        .map(|entry| entry.expect("a directory entry should be readable"))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with(".vidra-partial-"))
        .collect()
}

struct Effects {
    jobs: JobManager,
    history: HistoryManager,
    ledger: PartialLedger,
    finished: Vec<crate::ffmpeg::EncodeFinished>,
    pause: Vec<crate::ffmpeg::EncodePauseChanged>,
    history_events: Vec<crate::history::HistoryEntry>,
}

fn effects(directory: &Path) -> Effects {
    Effects {
        jobs: JobManager::default(),
        history: HistoryManager::new(directory.join("history.json")),
        ledger: PartialLedger::open(directory.join("partials.json")),
        finished: Vec::new(),
        pause: Vec::new(),
        history_events: Vec::new(),
    }
}

fn run_drive<T>(
    effects: &mut Effects,
    launch: impl FnMut(&crate::jobs::PendingJob, &partial::PartialOutput) -> Result<T, LaunchError>,
    watch: impl FnMut(T, super::WatchJob) -> Result<(), ApiError>,
) -> Result<(), ApiError> {
    let jobs = &effects.jobs;
    let history = &effects.history;
    let ledger = &effects.ledger;
    let finished_events = &mut effects.finished;
    let pause_events = &mut effects.pause;
    let recorded_history = &mut effects.history_events;
    let state = QueueState {
        jobs,
        history,
        ledger: Some(ledger),
    };
    let mut finished = |event| finished_events.push(event);
    let mut pause = |event| pause_events.push(event);
    let mut history_event = |entry| recorded_history.push(entry);
    let mut emits = Emits {
        finished: &mut finished,
        pause: &mut pause,
        history: &mut history_event,
    };
    drive_queue(&state, &mut emits, launch, watch)
}

#[test]
fn cancellation_wins_over_a_successful_exit_code() {
    assert_eq!(output_outcome(true, Some(0)), OutputOutcome::Cancelled);
    assert_eq!(output_outcome(true, Some(1)), OutputOutcome::Cancelled);
    assert_eq!(output_outcome(true, None), OutputOutcome::Cancelled);
    assert_eq!(output_outcome(false, Some(0)), OutputOutcome::Completed);
    assert_eq!(output_outcome(false, Some(1)), OutputOutcome::Failed);
    assert_eq!(output_outcome(false, None), OutputOutcome::Failed);
}

#[test]
fn enqueue_rejects_an_empty_batch_before_probe_or_disk_space() {
    let jobs = JobManager::default();
    let trace = trace_enqueue(
        &jobs,
        Vec::new(),
        |_| unreachable!("probe"),
        |_, _| unreachable!("disk"),
    );

    let error = trace.result.expect_err("an empty batch should be rejected");
    assert_eq!(error.code, "invalid_input");
    assert_eq!(error.message, super::empty_requests().message);
    assert!(trace.steps.is_empty());
}

#[test]
fn enqueue_validates_every_input_before_probe_and_disk_space() {
    let directory = TempDir::new("inputs-first");
    let first = write_source(directory.path(), "first.mov");
    let missing = directory.path().join("missing.mov");
    let jobs = JobManager::default();
    let requests = vec![
        request(&first, &directory.path().join("first-vidra.mp4")),
        request(&missing, &directory.path().join("missing-vidra.mp4")),
    ];
    let trace = trace_enqueue(
        &jobs,
        requests,
        |_| unreachable!("probe"),
        |_, _| unreachable!("disk"),
    );

    let error = trace
        .result
        .expect_err("a missing input should stop enqueue");
    assert_eq!(error.code, "invalid_input");
    assert!(error.message.contains("not accessible"));
    assert!(trace.steps.is_empty());
    assert!(jobs.reserve_next().unwrap().is_none());
}

#[test]
fn enqueue_probes_only_after_output_validation_and_checks_disk_space_last() {
    let directory = TempDir::new("order");
    let first = write_source(directory.path(), "first.mov");
    let second = write_source(directory.path(), "second.mov");
    let jobs = JobManager::default();
    let mut requests = vec![
        request(&first, &directory.path().join("first-vidra.mp4")),
        request(&second, &directory.path().join("second.mov")),
    ];
    requests[1].container = OutputContainer::Mp4;

    let trace = trace_enqueue(
        &jobs,
        requests,
        |path| Ok(media_info(Path::new(path))),
        |_, _| unreachable!("disk"),
    );

    let error = trace
        .result
        .expect_err("the wrong extension should be rejected");
    assert!(error.message.contains(".mp4"));
    assert_eq!(trace.steps.len(), 1);
    assert!(trace.steps[0].contains("first.mov"));
    assert!(!trace.steps[0].contains("second.mov"));
    assert!(jobs.reserve_next().unwrap().is_none());
}

#[test]
fn enqueue_rejects_duplicate_outputs_before_probing_the_duplicate() {
    let directory = TempDir::new("duplicate");
    fs::create_dir_all(directory.path().join("nested")).unwrap();
    let first = write_source(directory.path(), "first.mov");
    let second = write_source(directory.path(), "second.mov");
    let jobs = JobManager::default();
    let shared = directory.path().join("holiday-vidra.mp4");
    let aliased = directory
        .path()
        .join("nested")
        .join("..")
        .join("holiday-vidra.mp4");
    let trace = trace_enqueue(
        &jobs,
        vec![request(&first, &shared), request(&second, &aliased)],
        |path| Ok(media_info(Path::new(path))),
        |_, _| unreachable!("disk"),
    );

    let error = trace
        .result
        .expect_err("one output path should be rejected");
    assert_eq!(error.code, "invalid_input");
    assert!(error.message.contains("same output path"));
    assert_eq!(trace.steps.len(), 1);
    assert!(trace.steps[0].contains("first.mov"));
    assert!(jobs.reserve_next().unwrap().is_none());
}

#[test]
fn enqueue_checks_disk_space_after_probe_and_does_not_queue_a_rejected_batch() {
    let directory = TempDir::new("disk");
    let input = write_source(directory.path(), "clip.mov");
    let mut waiting = pending_job(
        "waiting",
        &input,
        &directory.path().join("waiting-vidra.mp4"),
    );
    waiting.estimated_output_bytes = 4_096;
    let jobs = JobManager::default();
    jobs.append(vec![waiting]).unwrap();
    let trace = trace_enqueue(
        &jobs,
        vec![request(&input, &directory.path().join("clip-vidra.mp4"))],
        |path| Ok(media_info(Path::new(path))),
        |prepared, reservations| {
            assert_eq!(prepared.len(), 1);
            assert!(prepared[0].0.output_path.ends_with("clip-vidra.mp4"));
            assert_eq!(reservations.len(), 1);
            assert_eq!(reservations[0].remaining_bytes, 4_096);
            Err(ApiError::new(
                "insufficient_disk_space",
                "This conversion may need more space.",
            ))
        },
    );

    let error = trace.result.expect_err("disk space should stop enqueue");
    assert_eq!(error.code, "insufficient_disk_space");
    assert_eq!(
        trace.steps,
        vec![format!("probe {}", input.display()), "disk".to_owned()]
    );
    match jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => assert_eq!(job.id, "waiting"),
        ReservedJob::Resumed(_) => panic!("the existing job should still be pending"),
    }
}

#[test]
fn enqueue_rejects_an_output_already_reserved_by_the_queue() {
    let directory = TempDir::new("reserved");
    let input = write_source(directory.path(), "clip.mov");
    // A queued job stores the canonical output. macOS reaches the temp
    // directory through /var, which resolves to /private/var.
    let stored = directory
        .path()
        .canonicalize()
        .unwrap()
        .join("clip-vidra.mp4");
    let jobs = JobManager::default();
    jobs.append(vec![pending_job("waiting", &input, &stored)])
        .unwrap();
    let trace = trace_enqueue(
        &jobs,
        vec![request(&input, &directory.path().join("clip-vidra.mp4"))],
        |path| Ok(media_info(Path::new(path))),
        |_, _| Ok(()),
    );

    let error = trace
        .result
        .expect_err("a reserved output should be rejected");
    assert_eq!(error.code, "invalid_input");
    assert!(error.message.contains("already uses"));
    assert_eq!(trace.steps.last().map(String::as_str), Some("disk"));
    match jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => assert_eq!(job.id, "waiting"),
        ReservedJob::Resumed(_) => panic!("the original job should stay queued"),
    }
}

#[test]
fn enqueue_queues_distinct_outputs_after_probe_and_disk_space() {
    let directory = TempDir::new("success");
    let first = write_source(directory.path(), "first.mov");
    let second = write_source(directory.path(), "second.mov");
    let jobs = JobManager::default();
    let queued = block_on(enqueue_prepared(
        &jobs,
        vec![
            request(&first, &directory.path().join("first-vidra.mp4")),
            request(&second, &directory.path().join("second-vidra.mp4")),
        ],
        Some("ffmpeg test".to_owned()),
        |path| std::future::ready(Ok(media_info(Path::new(&path)))),
        ensure_output_space,
    ))
    .expect("a batch with free space should be queued");

    assert_eq!(queued.len(), 2);
    assert_eq!(queued[0].job_id, "job-1");
    assert_eq!(queued[1].job_id, "job-2");
    let canonical_output = directory
        .path()
        .canonicalize()
        .unwrap()
        .join("first-vidra.mp4");
    assert_eq!(PathBuf::from(&queued[0].output_path), canonical_output);
    match jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => {
            assert_eq!(job.id, "job-1");
            assert_eq!(job.ffmpeg_version.as_deref(), Some("ffmpeg test"));
            assert_eq!(
                PathBuf::from(&job.request.input_path),
                first.canonicalize().unwrap()
            );
        }
        ReservedJob::Resumed(_) => panic!("the first job should start as pending"),
    }
}

#[test]
fn enqueue_stops_before_disk_space_when_settings_are_rejected() {
    let directory = TempDir::new("settings");
    let input = write_source(directory.path(), "clip.mov");
    let jobs = JobManager::default();
    let mut encode = request(&input, &directory.path().join("clip-vidra.mp4"));
    encode.quality_tuning = 9;
    let trace = trace_enqueue(
        &jobs,
        vec![encode],
        |path| Ok(media_info(Path::new(path))),
        |_, _| unreachable!("disk"),
    );

    let error = trace.result.expect_err("tuning should be rejected");
    assert!(error.message.contains("fine tuning"));
    assert_eq!(trace.steps, vec![format!("probe {}", input.display())]);
    assert!(jobs.reserve_next().unwrap().is_none());
}

#[test]
fn a_failed_spawn_cleans_up_and_starts_the_next_queued_job() {
    let directory = TempDir::new("spawn");
    let mut effects = effects(directory.path());
    let first = write_source(directory.path(), "first.mov");
    let second = write_source(directory.path(), "second.mov");
    effects
        .jobs
        .append(vec![
            pending_job("job-1", &first, &directory.path().join("first-vidra.mp4")),
            pending_job("job-2", &second, &directory.path().join("second-vidra.mp4")),
        ])
        .unwrap();
    let launches = Cell::new(0);

    run_drive(
        &mut effects,
        |job, partial| {
            launches.set(launches.get() + 1);
            if job.id == "job-1" {
                assert!(partial.path.exists());
                Err(LaunchError::Spawn(ApiError::ffmpeg(
                    "could not spawn the encoder",
                )))
            } else {
                assert_eq!(job.id, "job-2");
                assert!(partial.path.exists());
                Ok(())
            }
        },
        |_spawned, watched| {
            assert_eq!(watched.job_id, "job-2");
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(launches.get(), 2);
    let names = partial_names(directory.path());
    assert!(names.iter().all(|name| !name.contains("job-1")));
    assert!(names.iter().any(|name| name.contains("job-2")));
    assert_eq!(effects.finished.len(), 1);
    assert_eq!(effects.finished[0].job_id, "job-1");
    assert_eq!(effects.finished[0].status, "failed");
    assert!(effects.finished[0].error.is_some());
    assert_eq!(effects.history_events[0].status, HistoryStatus::Failed);
    assert!(effects.jobs.reserve_next().unwrap().is_none());
    effects.jobs.finish_active("job-2").unwrap();
    assert!(effects.jobs.reserve_next().unwrap().is_none());
    assert!(!directory.path().join("first-vidra.mp4").exists());
}

#[test]
fn a_blocked_start_is_failed_and_the_next_job_can_run() {
    let directory = TempDir::new("blocked");
    let mut effects = effects(directory.path());
    let first = write_source(directory.path(), "first.mov");
    let second = write_source(directory.path(), "second.mov");
    effects
        .jobs
        .append(vec![
            pending_job("job-1", &first, &directory.path().join("first-vidra.mp4")),
            pending_job("job-2", &second, &directory.path().join("second-vidra.mp4")),
        ])
        .unwrap();
    fs::remove_file(&first).unwrap();
    let launches = Cell::new(0);

    run_drive(
        &mut effects,
        |_job, _partial| {
            launches.set(launches.get() + 1);
            Ok(())
        },
        |_spawned, watched| {
            assert_eq!(watched.job_id, "job-2");
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(launches.get(), 1);
    assert!(partial_names(directory.path())
        .iter()
        .all(|name| !name.contains("job-1")));
    assert_eq!(effects.finished[0].status, "failed");
    assert!(effects.finished[0]
        .error
        .as_deref()
        .unwrap()
        .contains("not accessible"));
    assert!(effects.jobs.reserve_next().unwrap().is_none());
}

#[test]
fn a_command_that_cannot_be_built_removes_its_partial_and_continues() {
    let directory = TempDir::new("prepare");
    let mut effects = effects(directory.path());
    let input = write_source(directory.path(), "clip.mov");
    effects
        .jobs
        .append(vec![
            pending_job("job-1", &input, &directory.path().join("one-vidra.mp4")),
            pending_job("job-2", &input, &directory.path().join("two-vidra.mp4")),
        ])
        .unwrap();

    run_drive(
        &mut effects,
        |job, partial| {
            if job.id == "job-1" {
                assert!(partial.path.exists());
                Err(LaunchError::Prepare(ApiError::ffmpeg(
                    "The selected encoder is unavailable.",
                )))
            } else {
                Ok(())
            }
        },
        |_spawned, watched| {
            assert_eq!(watched.job_id, "job-2");
            Ok(())
        },
    )
    .unwrap();

    assert!(partial_names(directory.path())
        .iter()
        .all(|name| !name.contains("job-1")));
    assert_eq!(
        effects.finished[0].error.as_deref(),
        Some("The selected encoder is unavailable.")
    );
    assert_eq!(effects.finished[0].status, "failed");
    assert!(effects.jobs.reserve_next().unwrap().is_none());
}

#[test]
fn only_one_encode_starts_and_a_running_job_blocks_the_queue() {
    let directory = TempDir::new("single");
    let mut effects = effects(directory.path());
    let input = write_source(directory.path(), "clip.mov");
    effects
        .jobs
        .append(vec![
            pending_job("job-1", &input, &directory.path().join("one-vidra.mp4")),
            pending_job("job-2", &input, &directory.path().join("two-vidra.mp4")),
        ])
        .unwrap();
    let launches = Cell::new(0);
    run_drive(
        &mut effects,
        |_job, _partial| {
            launches.set(launches.get() + 1);
            Ok(())
        },
        |_spawned, watched| {
            assert_eq!(watched.job_id, "job-1");
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(launches.get(), 1);
    assert!(effects.finished.is_empty());
    assert!(effects.jobs.reserve_next().unwrap().is_none());

    let launches_while_busy = Cell::new(0);
    run_drive(
        &mut effects,
        |_job, _partial| {
            launches_while_busy.set(launches_while_busy.get() + 1);
            Ok(())
        },
        |_spawned, _watched| Ok(()),
    )
    .unwrap();
    assert_eq!(launches_while_busy.get(), 0);

    effects.jobs.finish_active("job-1").unwrap();
    match effects.jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => assert_eq!(job.id, "job-2"),
        ReservedJob::Resumed(_) => panic!("the second job should still be pending"),
    }
}

#[cfg(unix)]
#[test]
fn resuming_a_paused_encode_does_not_start_another_one() {
    let directory = TempDir::new("resume");
    let mut effects = effects(directory.path());
    let input = write_source(directory.path(), "clip.mov");
    effects
        .jobs
        .append(vec![
            pending_job("paused", &input, &directory.path().join("paused-vidra.mp4")),
            pending_job("later", &input, &directory.path().join("later-vidra.mp4")),
        ])
        .unwrap();
    match effects.jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => assert_eq!(job.id, "paused"),
        ReservedJob::Resumed(_) => panic!("the first start should be pending"),
    }
    let mut sleep = Command::new("sleep").arg("30").spawn().unwrap();
    let process_id = sleep.id();
    effects
        .jobs
        .attach_running(
            "paused",
            RunningProcess::from_stop(process_id, move || {
                // SAFETY: the PID belongs to the sleep process spawned above.
                let _ = unsafe { libc::kill(process_id as libc::pid_t, libc::SIGKILL) };
                Ok(())
            }),
        )
        .unwrap();
    effects.jobs.set_paused("paused", true).unwrap();

    let launches = Cell::new(0);
    run_drive(
        &mut effects,
        |_job, _partial| {
            launches.set(launches.get() + 1);
            Ok(())
        },
        |_spawned, _watched| Ok(()),
    )
    .unwrap();

    assert_eq!(launches.get(), 0);
    assert_eq!(effects.pause.len(), 1);
    assert_eq!(effects.pause[0].job_id, "paused");
    assert!(!effects.pause[0].paused);
    assert!(effects.jobs.reserve_next().unwrap().is_none());
    match effects.jobs.cancel("paused").unwrap() {
        crate::jobs::CancelledJob::Active { process } => process.stop().unwrap(),
        crate::jobs::CancelledJob::Pending(_) => panic!("the resumed job should be active"),
    }
    let _ = sleep.wait();
}

#[test]
fn move_pending_reorders_waiting_jobs_and_rejects_bad_movement() {
    let jobs = JobManager::default();
    let directory = TempDir::new("move");
    let input = write_source(directory.path(), "clip.mov");
    jobs.append(vec![
        pending_job("one", &input, &directory.path().join("one-vidra.mp4")),
        pending_job("two", &input, &directory.path().join("two-vidra.mp4")),
        pending_job("three", &input, &directory.path().join("three-vidra.mp4")),
    ])
    .unwrap();

    move_pending(&jobs, "three", -1).unwrap();
    move_pending(&jobs, "three", -1).unwrap();
    move_pending(&jobs, "three", -1).unwrap();
    let unknown = move_pending(&jobs, "missing", 1).unwrap_err();
    assert!(unknown.message.contains("waiting"));
    let direction = move_pending(&jobs, "three", 2).unwrap_err();
    assert!(direction.message.contains("-1 or 1"));

    match jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => assert_eq!(job.id, "three"),
        ReservedJob::Resumed(_) => panic!("the moved job should be pending"),
    }
    jobs.finish_active("three").unwrap();
    match jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => assert_eq!(job.id, "one"),
        ReservedJob::Resumed(_) => panic!("the next job should be pending"),
    }
}

#[test]
fn cancelling_a_queued_job_leaves_the_destination_and_reports_cancellation() {
    let directory = TempDir::new("cancel-queued");
    let jobs = JobManager::default();
    let input = write_source(directory.path(), "clip.mov");
    let output = directory.path().join("clip-vidra.mp4");
    fs::write(&output, b"already there").unwrap();
    jobs.append(vec![
        pending_job("keep", &input, &directory.path().join("keep-vidra.mp4")),
        pending_job("drop", &input, &output),
    ])
    .unwrap();
    let mut events = Vec::new();

    cancel_job(&jobs, "drop", |event| {
        events.push(event);
        Ok(())
    })
    .unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].job_id, "drop");
    assert_eq!(events[0].status, "cancelled");
    assert!(events[0].error.is_none());
    assert_eq!(fs::read(&output).unwrap(), b"already there");
    assert!(partial_names(directory.path()).is_empty());
    match jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => assert_eq!(job.id, "keep"),
        ReservedJob::Resumed(_) => panic!("the other job should stay queued"),
    }
}

#[test]
fn cancelling_a_running_job_stops_the_encoder_and_finish_removes_the_partial() {
    let directory = TempDir::new("cancel-running");
    let mut session = effects(directory.path());
    let input = write_source(directory.path(), "clip.mov");
    let output = directory.path().join("clip-vidra.mp4");
    fs::write(&output, b"original destination").unwrap();
    session
        .jobs
        .append(vec![pending_job("running", &input, &output)])
        .unwrap();
    let job = match session.jobs.reserve_next().unwrap().unwrap() {
        ReservedJob::Pending(job) => job,
        ReservedJob::Resumed(_) => panic!("the job should start pending"),
    };
    let partial =
        partial::create_partial(&output, &job.id, "mp4", &[], std::slice::from_ref(&input))
            .unwrap();
    fs::write(&partial.path, b"unfinished video").unwrap();
    session.ledger.record(&partial).unwrap();
    session.jobs.set_partial(&job.id, partial.clone()).unwrap();
    let stopped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = std::sync::Arc::clone(&stopped);
    session
        .jobs
        .attach_running(
            &job.id,
            RunningProcess::from_stop(9, move || {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
                Ok(())
            }),
        )
        .unwrap();

    cancel_job(&session.jobs, &job.id, |_| {
        unreachable!("a running cancel does not emit yet")
    })
    .unwrap();

    assert!(stopped.load(std::sync::atomic::Ordering::Relaxed));
    assert!(partial.path.exists());
    assert_eq!(fs::read(&output).unwrap(), b"original destination");
    assert!(session.jobs.reserve_next().unwrap().is_none());

    finish_encode(&mut session, *job, partial, Some(0));

    assert_eq!(session.finished[0].status, "cancelled");
    assert!(session.finished[0].error.is_none());
    assert!(session.finished[0].diagnostic.is_none());
    assert_eq!(session.history_events[0].status, HistoryStatus::Cancelled);
    assert!(!partial_names(directory.path())
        .iter()
        .any(|name| name.contains("running")));
    assert_eq!(fs::read(&output).unwrap(), b"original destination");
    assert!(session.jobs.reserve_next().unwrap().is_none());
}

#[test]
fn finish_maps_exit_codes_to_queue_status_and_cleans_the_partial() {
    let cases = [
        (Some(0), false, "completed", HistoryStatus::Completed),
        (Some(1), false, "failed", HistoryStatus::Failed),
        (None, false, "failed", HistoryStatus::Failed),
        (Some(0), true, "cancelled", HistoryStatus::Cancelled),
        (Some(7), true, "cancelled", HistoryStatus::Cancelled),
    ];

    for (exit_code, cancelled, status, history_status) in cases {
        let directory = TempDir::new(&format!("finish-{status}-{cancelled}"));
        let mut session = effects(directory.path());
        let input = write_source(directory.path(), "clip.mov");
        let output = directory.path().join("clip-vidra.mp4");
        session
            .jobs
            .append(vec![pending_job("job", &input, &output)])
            .unwrap();
        let job = match session.jobs.reserve_next().unwrap().unwrap() {
            ReservedJob::Pending(job) => job,
            ReservedJob::Resumed(_) => panic!("the job should start pending"),
        };
        let partial =
            partial::create_partial(&output, &job.id, "mp4", &[], std::slice::from_ref(&input))
                .unwrap();
        fs::write(&partial.path, b"finished-bytes").unwrap();
        session.ledger.record(&partial).unwrap();
        if cancelled {
            session
                .jobs
                .attach_running(&job.id, RunningProcess::from_stop(4, || Ok(())))
                .unwrap();
            cancel_job(&session.jobs, &job.id, |_| Ok(())).unwrap();
        }

        finish_encode(&mut session, *job, partial.clone(), exit_code);

        assert_eq!(session.finished[0].status, status);
        assert_eq!(session.history_events[0].status, history_status);
        assert!(!partial.path.exists());
        if status == "completed" {
            assert_eq!(fs::read(&output).unwrap(), b"finished-bytes");
            assert!(session.finished[0].error.is_none());
        } else {
            assert!(!output.exists());
            if status == "failed" {
                assert!(session.finished[0].error.is_some());
                assert!(session.finished[0].diagnostic.is_some());
            } else {
                assert!(session.finished[0].error.is_none());
            }
        }
        assert!(session.jobs.reserve_next().unwrap().is_none());
    }
}

fn finish_encode(
    session: &mut Effects,
    job: crate::jobs::PendingJob,
    partial: partial::PartialOutput,
    exit_code: Option<i32>,
) {
    let jobs = &session.jobs;
    let history = &session.history;
    let ledger = &session.ledger;
    let finished_events = &mut session.finished;
    let pause_events = &mut session.pause;
    let recorded_history = &mut session.history_events;
    let state = QueueState {
        jobs,
        history,
        ledger: Some(ledger),
    };
    let mut finished = |event| finished_events.push(event);
    let mut pause = |event| pause_events.push(event);
    let mut history_event = |entry| recorded_history.push(entry);
    let mut emits = Emits {
        finished: &mut finished,
        pause: &mut pause,
        history: &mut history_event,
    };
    let history = crate::history::HistoryDraft::from_job(&job, 1);
    finish_with(
        &state,
        &mut emits,
        FinishedEncode {
            job_id: job.id.clone(),
            output_path: job.request.output_path.clone(),
            history,
            job: Box::new(job),
            partial,
            replace_identity: None,
            log: BoundedLog::default(),
            exit_code,
        },
    );
}
