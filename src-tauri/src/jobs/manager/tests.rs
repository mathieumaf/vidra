use super::{ActiveJob, JobManager};
use crate::{
    ffmpeg::{
        AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodeRequest, EncodingSpeed,
        MediaInfo, OutputContainer, OutputFrameRate, OutputResolution, QualityLevel, VideoCodec,
    },
    jobs::{PendingJob, ReservedJob},
};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

fn pending(id: &str) -> PendingJob {
    PendingJob {
        id: id.to_owned(),
        estimated_output_bytes: 0,
        request: EncodeRequest {
            input_path: format!("/{id}.mov"),
            output_path: format!("/{id}.mp4"),
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
            trim: None,
        },
        media: MediaInfo {
            path: format!("/{id}.mov"),
            name: format!("{id}.mov"),
            duration_seconds: 10.0,
            size_bytes: 100,
            format_name: "mov".to_owned(),
            format_long_name: Some("QuickTime / MOV".to_owned()),
            video: None,
            audio: vec![],
            subtitles: vec![],
            chapter_count: 0,
            chapters: Vec::new(),
            has_metadata: false,
        },
        ffmpeg_version: Some("ffmpeg test".to_owned()),
    }
}

fn pending_id(job: ReservedJob) -> String {
    match job {
        ReservedJob::Pending(job) => job.id,
        ReservedJob::Resumed(_) => panic!("expected a pending job"),
    }
}

#[test]
fn pending_jobs_can_be_reordered() {
    let manager = JobManager::default();
    manager
        .append(vec![pending("one"), pending("two"), pending("three")])
        .unwrap();

    manager.move_waiting("three", -1).unwrap();

    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "one");
    manager.finish_active("one").unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "three"
    );
}

#[test]
fn a_waiting_job_can_move_ahead_of_a_suspended_job() {
    let manager = JobManager::default();
    manager
        .append(vec![pending("one"), pending("two")])
        .unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.suspended.push_back(ActiveJob {
            id: "paused".to_owned(),
            output_path: "/paused.mp4".to_owned(),
            estimated_output_bytes: 0,
            process: None,
            process_id: None,
            paused: true,
            partial: None,
        });
        state.waiting_order.push_front("paused".to_owned());
    }

    manager.move_waiting("two", -1).unwrap();
    manager.move_waiting("two", -1).unwrap();

    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "two");
}

#[test]
fn rejects_output_paths_already_used_by_the_queue() {
    let manager = JobManager::default();
    manager.append(vec![pending("one")]).unwrap();
    let mut duplicate = pending("two");
    duplicate.request.output_path = "/one.mp4".to_owned();

    assert!(manager.append(vec![duplicate]).is_err());
}

#[test]
fn allows_the_same_input_with_distinct_outputs() {
    let manager = JobManager::default();
    let first = pending("first");
    let mut second = pending("second");
    second.request.input_path = first.request.input_path.clone();
    second.media.path = first.media.path.clone();

    manager.append(vec![first, second]).unwrap();

    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "first"
    );
}

#[test]
fn reports_space_reserved_by_pending_and_active_jobs() {
    let manager = JobManager::default();
    let mut job = pending("reserved");
    job.estimated_output_bytes = 4_096;
    manager.append(vec![job]).unwrap();

    let pending_reservations = manager.disk_space_reservations().unwrap();
    assert_eq!(pending_reservations.len(), 1);
    assert_eq!(pending_reservations[0].remaining_bytes, 4_096);

    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "reserved"
    );
    let active_reservations = manager.disk_space_reservations().unwrap();
    assert_eq!(active_reservations.len(), 1);
    assert_eq!(active_reservations[0].remaining_bytes, 4_096);
}

#[test]
fn sleep_is_prevented_only_while_a_job_is_active() {
    let manager = JobManager::default();
    manager.append(vec![pending("one")]).unwrap();
    assert!(!manager.sleep_preventer.is_active());

    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "one");
    assert!(manager.sleep_preventer.is_active());

    manager.finish_active("one").unwrap();
    assert!(!manager.sleep_preventer.is_active());
}

#[test]
fn update_requires_an_empty_conversion_queue() {
    let manager = JobManager::default();
    manager.append(vec![pending("waiting")]).unwrap();

    let error = match manager.begin_update() {
        Ok(_) => panic!("an update must not start while a conversion is queued"),
        Err(error) => error,
    };

    assert_eq!(error.code, "conversion_in_progress");
}

#[test]
fn update_rejects_running_and_paused_conversions() {
    for paused in [false, true] {
        let manager = JobManager::default();
        let job = ActiveJob {
            id: "active".to_owned(),
            output_path: "/active.mp4".to_owned(),
            estimated_output_bytes: 0,
            process: None,
            process_id: None,
            paused,
            partial: None,
        };
        let mut state = manager.state.lock().unwrap();
        if paused {
            state.suspended.push_back(job);
        } else {
            state.active = Some(job);
        }
        drop(state);

        let error = match manager.begin_update() {
            Ok(_) => panic!("an update must not start during a conversion"),
            Err(error) => error,
        };
        assert_eq!(error.code, "conversion_in_progress");
    }
}

#[test]
fn update_guard_blocks_new_and_starting_conversions() {
    let manager = JobManager::default();
    let guard = manager.begin_update().unwrap();

    assert_eq!(
        manager.append(vec![pending("waiting")]).unwrap_err().code,
        "update_in_progress"
    );
    let error = match manager.reserve_next() {
        Ok(_) => panic!("a conversion must not start during an update"),
        Err(error) => error,
    };
    assert_eq!(error.code, "update_in_progress");

    drop(guard);
    manager.append(vec![pending("waiting")]).unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "waiting"
    );
}

#[cfg(unix)]
#[test]
fn pausing_releases_sleep_prevention_and_resuming_restores_it() {
    use std::process::Command;

    let manager = JobManager::default();
    let mut process =
        crate::jobs::process::ChildGuard(Command::new("sleep").arg("30").spawn().unwrap());
    let process_id = process.0.id();
    manager.sleep_preventer.activate().unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.active = Some(ActiveJob {
            id: "active".to_owned(),
            output_path: "/active.mp4".to_owned(),
            estimated_output_bytes: 0,
            process: None,
            process_id: Some(process_id),
            paused: false,
            partial: None,
        });
    }

    manager.set_paused("active", true).unwrap();
    assert!(!manager.sleep_preventer.is_active());

    manager.set_paused("active", false).unwrap();
    assert!(manager.sleep_preventer.is_active());

    manager.finish_active("active").unwrap();
    assert!(!manager.sleep_preventer.is_active());
    process.0.kill().unwrap();
    process.0.wait().unwrap();
}

#[test]
fn a_poisoned_queue_lock_still_reports_reserved_output_paths() {
    let manager = JobManager::default();
    manager.append(vec![pending("waiting")]).unwrap();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = manager.state.lock().unwrap();
        panic!("poison the queue lock");
    }));
    let reserved = manager.reserved_output_paths().unwrap();
    assert!(reserved.iter().any(|path| path.ends_with("waiting.mp4")));
}

#[test]
fn shutdown_removes_partials_and_keeps_existing_destinations() {
    use crate::output::partial::create_partial;

    let manager = JobManager::default();
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "vidra-shutdown-test-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).unwrap();
    let output = directory.join("holiday-vidra.mp4");
    let waiting_output = directory.join("waiting-vidra.mp4");
    fs::write(&output, b"original destination").unwrap();
    fs::write(&waiting_output, b"waiting destination").unwrap();
    let partial = create_partial(&output, "active", "mp4", &[], &[]).unwrap();
    fs::write(&partial.path, b"unfinished").unwrap();
    let mut waiting = pending("waiting");
    waiting.request.output_path = waiting_output.to_string_lossy().into_owned();
    manager.append(vec![waiting]).unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.active = Some(ActiveJob {
            id: "active".to_owned(),
            output_path: output.to_string_lossy().into_owned(),
            estimated_output_bytes: 0,
            process: None,
            process_id: None,
            paused: false,
            partial: Some(partial.clone()),
        });
    }
    manager.sleep_preventer.activate().unwrap();
    assert!(manager.sleep_preventer.is_active());

    manager.shutdown();

    assert_eq!(fs::read(&output).unwrap(), b"original destination");
    assert_eq!(fs::read(&waiting_output).unwrap(), b"waiting destination");
    assert!(!partial.path.exists());
    assert!(!manager.sleep_preventer.is_active());
    let state = manager.state.lock().unwrap();
    assert!(state.active.is_none());
    assert!(state.suspended.is_empty());
    assert!(state.pending.is_empty());
    assert!(state.waiting_order.is_empty());
    drop(state);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn reservations_count_the_partial_file_and_keep_the_destination_reserved() {
    use crate::output::partial::PartialOutput;

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "vidra-reservation-test-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).unwrap();
    let destination = directory.join("holiday-vidra.mp4");
    let partial_path = directory.join(".vidra-partial-reserved-abc123.mp4");
    fs::write(&destination, vec![7_u8; 8_000]).unwrap();
    fs::write(&partial_path, vec![9_u8; 1_000]).unwrap();

    let manager = JobManager::default();
    let mut job = pending("reserved");
    job.request.output_path = destination.to_string_lossy().into_owned();
    job.request.replace_existing = true;
    job.estimated_output_bytes = 4_096;
    manager.append(vec![job]).unwrap();

    assert_eq!(
        manager.disk_space_reservations().unwrap()[0].remaining_bytes,
        4_096
    );
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "reserved"
    );
    manager
        .set_partial(
            "reserved",
            PartialOutput {
                path: partial_path,
                device: 0,
                inode: 0,
            },
        )
        .unwrap();

    assert_eq!(
        manager.disk_space_reservations().unwrap()[0].remaining_bytes,
        3_096
    );
    assert_eq!(fs::metadata(&destination).unwrap().len(), 8_000);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn only_one_job_can_be_active() {
    let manager = JobManager::default();
    manager
        .append(vec![pending("one"), pending("two")])
        .unwrap();

    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "one");
    assert!(manager.reserve_next().unwrap().is_none());

    manager.finish_active("one").unwrap();
    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "two");
    assert!(manager.reserve_next().unwrap().is_none());
}

#[test]
fn a_batch_cannot_reserve_one_output_path_twice() {
    let manager = JobManager::default();
    let mut duplicate = pending("two");
    duplicate.request.output_path = "/one.mp4".to_owned();

    let error = manager.append(vec![pending("one"), duplicate]).unwrap_err();

    assert_eq!(error.code, "invalid_input");
    assert!(error.message.contains("already uses"));
    assert!(manager.reserve_next().unwrap().is_none());
}

#[test]
fn active_and_paused_outputs_stay_reserved() {
    for paused in [false, true] {
        let manager = JobManager::default();
        let job = ActiveJob {
            id: "busy".to_owned(),
            output_path: "/busy.mp4".to_owned(),
            estimated_output_bytes: 0,
            process: None,
            process_id: None,
            paused,
            partial: None,
        };
        {
            let mut state = manager.state.lock().unwrap();
            if paused {
                state.suspended.push_back(job);
                state.waiting_order.push_front("busy".to_owned());
            } else {
                state.active = Some(job);
            }
        }
        let mut duplicate = pending("next");
        duplicate.request.output_path = "/busy.mp4".to_owned();

        let error = manager.append(vec![duplicate]).unwrap_err();
        assert!(error.message.contains("already uses"));
    }
}

#[test]
fn waiting_jobs_move_up_and_down_and_stop_at_the_ends() {
    let manager = JobManager::default();
    manager
        .append(vec![pending("one"), pending("two"), pending("three")])
        .unwrap();

    manager.move_waiting("one", -1).unwrap();
    manager.move_waiting("three", 1).unwrap();
    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "one");
    manager.finish_active("one").unwrap();

    manager.move_waiting("three", -1).unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "three"
    );
    manager.finish_active("three").unwrap();
    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "two");
}

#[test]
fn queue_movement_rejects_unknown_jobs_and_other_directions() {
    let manager = JobManager::default();
    manager.append(vec![pending("one")]).unwrap();

    let unknown = manager.move_waiting("missing", 1).unwrap_err();
    assert_eq!(unknown.code, "invalid_input");
    assert!(unknown.message.contains("waiting"));

    let direction = manager.move_waiting("one", 0).unwrap_err();
    assert_eq!(direction.code, "invalid_input");
    assert!(direction.message.contains("-1 or 1"));
    let direction = manager.move_waiting("one", 2).unwrap_err();
    assert!(direction.message.contains("-1 or 1"));

    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "one");
}

#[test]
fn cancelling_a_queued_job_removes_only_that_job() {
    let manager = JobManager::default();
    manager
        .append(vec![pending("one"), pending("two"), pending("three")])
        .unwrap();

    let cancelled = manager.cancel("two").unwrap();
    match cancelled {
        crate::jobs::CancelledJob::Pending(job) => assert_eq!(job.id, "two"),
        crate::jobs::CancelledJob::Active { .. } => panic!("a queued job has no encoder"),
    }

    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "one");
    manager.finish_active("one").unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "three"
    );
    let missing = match manager.cancel("two") {
        Ok(_) => panic!("a removed job should stay out of the queue"),
        Err(error) => error,
    };
    assert_eq!(missing.code, "invalid_input");
    assert!(missing.message.contains("not queued"));
}

#[test]
fn cancelling_a_running_job_stops_it_and_keeps_the_slot_until_it_finishes() {
    use crate::jobs::process::RunningProcess;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    let manager = JobManager::default();
    manager
        .append(vec![pending("running"), pending("next")])
        .unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "running"
    );
    let stopped = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stopped);
    manager
        .attach_running(
            "running",
            RunningProcess::from_stop(42, move || {
                flag.store(true, Ordering::Relaxed);
                Ok(())
            }),
        )
        .unwrap();

    match manager.cancel("running").unwrap() {
        crate::jobs::CancelledJob::Active { process } => process.stop().unwrap(),
        crate::jobs::CancelledJob::Pending(_) => panic!("the running job should be active"),
    }

    assert!(stopped.load(Ordering::Relaxed));
    assert!(manager.take_cancelled("running"));
    assert!(!manager.take_cancelled("running"));
    assert!(manager.reserve_next().unwrap().is_none());
    manager.finish_active("running").unwrap();
    assert_eq!(pending_id(manager.reserve_next().unwrap().unwrap()), "next");
}

#[test]
fn attaching_to_a_missing_or_different_job_stops_the_encoder() {
    use crate::jobs::process::RunningProcess;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    let manager = JobManager::default();
    let stopped = Arc::new(AtomicUsize::new(0));
    let flag = Arc::clone(&stopped);
    let error = manager
        .attach_running(
            "missing",
            RunningProcess::from_stop(7, move || {
                flag.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }),
        )
        .unwrap_err();
    assert_eq!(error.code, "job_state_error");
    assert!(error.message.contains("unavailable"));
    assert_eq!(stopped.load(Ordering::Relaxed), 1);

    manager.append(vec![pending("active")]).unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "active"
    );
    let flag = Arc::clone(&stopped);
    let error = manager
        .attach_running(
            "other",
            RunningProcess::from_stop(8, move || {
                flag.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }),
        )
        .unwrap_err();
    assert!(error.message.contains("unexpected"));
    assert_eq!(stopped.load(Ordering::Relaxed), 2);
    assert!(manager.reserve_next().unwrap().is_none());
}

#[test]
fn a_poisoned_lock_still_reports_cancellation() {
    let manager = JobManager::default();
    manager.append(vec![pending("running")]).unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "running"
    );
    manager
        .attach_running(
            "running",
            crate::jobs::process::RunningProcess::from_stop(4, || Ok(())),
        )
        .unwrap();
    match manager.cancel("running").unwrap() {
        crate::jobs::CancelledJob::Active { process } => process.stop().unwrap(),
        crate::jobs::CancelledJob::Pending(_) => panic!("the running job should be active"),
    }
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = manager.state.lock().unwrap();
        panic!("poison the queue lock");
    }));

    assert!(manager.take_cancelled("running"));
    assert!(!manager.take_cancelled("running"));
}

#[test]
fn cancelling_before_the_process_exists_leaves_the_job_running() {
    let manager = JobManager::default();
    manager.append(vec![pending("starting")]).unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "starting"
    );

    let error = match manager.cancel("starting") {
        Ok(_) => panic!("a job that is still starting cannot be cancelled yet"),
        Err(error) => error,
    };
    assert_eq!(error.code, "job_state_error");
    assert!(error.message.contains("still starting"));
    assert!(manager.reserve_next().unwrap().is_none());
    assert!(!manager.take_cancelled("starting"));
}

#[cfg(unix)]
#[test]
fn pause_and_resume_bookkeeping_keeps_a_single_active_encoder() {
    use crate::jobs::process::RunningProcess;
    use std::process::Command;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    let manager = JobManager::default();
    manager
        .append(vec![pending("active"), pending("later")])
        .unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "active"
    );
    let mut sleep =
        crate::jobs::process::ChildGuard(Command::new("sleep").arg("30").spawn().unwrap());
    let process_id = sleep.0.id();
    let stopped = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stopped);
    manager
        .attach_running(
            "active",
            RunningProcess::from_stop(process_id, move || {
                flag.store(true, Ordering::Relaxed);
                // SAFETY: the PID belongs to the sleep process spawned above.
                let _ = unsafe { libc::kill(process_id as libc::pid_t, libc::SIGKILL) };
                Ok(())
            }),
        )
        .unwrap();

    manager.set_paused("active", true).unwrap();
    {
        let state = manager.state.lock().unwrap();
        assert!(state.active.is_none());
        assert_eq!(state.suspended.len(), 1);
        assert!(state.suspended[0].paused);
        assert_eq!(
            state
                .waiting_order
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["active", "later"]
        );
    }
    assert!(!manager.sleep_preventer.is_active());

    let not_running = manager.set_paused("later", true).unwrap_err();
    assert!(not_running.message.contains("not running"));

    manager.set_paused("active", false).unwrap();
    {
        let state = manager.state.lock().unwrap();
        assert_eq!(
            state.active.as_ref().map(|job| job.id.as_str()),
            Some("active")
        );
        assert!(!state.active.as_ref().unwrap().paused);
        assert!(state.suspended.is_empty());
        assert_eq!(
            state
                .waiting_order
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["later"]
        );
    }
    assert!(manager.sleep_preventer.is_active());

    manager.set_paused("active", true).unwrap();
    manager.move_waiting("later", -1).unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "later"
    );
    let blocked = manager.set_paused("active", false).unwrap_err();
    assert_eq!(blocked.code, "encode_in_progress");
    manager.finish_active("later").unwrap();

    manager.append(vec![pending("tail")]).unwrap();
    manager.move_waiting("tail", -1).unwrap();
    let not_front = manager.set_paused("active", false).unwrap_err();
    assert!(not_front.message.contains("front of the queue"));
    manager.move_waiting("active", -1).unwrap();

    match manager.reserve_next().unwrap().unwrap() {
        ReservedJob::Resumed(job_id) => assert_eq!(job_id, "active"),
        ReservedJob::Pending(_) => panic!("the paused encoder should resume"),
    }
    assert!(manager.reserve_next().unwrap().is_none());
    assert!(manager.sleep_preventer.is_active());

    match manager.cancel("active").unwrap() {
        crate::jobs::CancelledJob::Active { process } => process.stop().unwrap(),
        crate::jobs::CancelledJob::Pending(_) => panic!("the resumed job should be active"),
    }
    assert!(stopped.load(Ordering::Relaxed));
    let _ = sleep.0.wait();
}

#[test]
fn partial_files_can_be_recorded_and_cleared_only_for_the_active_job() {
    use crate::output::partial::PartialOutput;

    let manager = JobManager::default();
    let partial = PartialOutput {
        path: std::path::PathBuf::from("/tmp/vidra-partial-test.mp4"),
        device: 1,
        inode: 2,
    };
    let missing = manager.set_partial("missing", partial.clone()).unwrap_err();
    assert_eq!(missing.code, "job_state_error");

    manager.append(vec![pending("active")]).unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "active"
    );
    let changed = manager.set_partial("other", partial.clone()).unwrap_err();
    assert!(changed.message.contains("changed unexpectedly"));
    manager.set_partial("active", partial).unwrap();
    manager.clear_partial("other").unwrap();
    assert!(manager
        .reserved_output_paths()
        .unwrap()
        .iter()
        .any(|path| path.ends_with("vidra-partial-test.mp4")));
    manager.clear_partial("active").unwrap();
    assert!(!manager
        .reserved_output_paths()
        .unwrap()
        .iter()
        .any(|path| path.ends_with("vidra-partial-test.mp4")));
}

#[test]
fn finishing_a_paused_job_removes_it_from_the_waiting_order() {
    let manager = JobManager::default();
    manager.append(vec![pending("later")]).unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.suspended.push_back(ActiveJob {
            id: "paused".to_owned(),
            output_path: "/paused.mp4".to_owned(),
            estimated_output_bytes: 0,
            process: None,
            process_id: None,
            paused: true,
            partial: None,
        });
        state.waiting_order.push_front("paused".to_owned());
    }

    manager.finish_active("paused").unwrap();
    assert_eq!(
        pending_id(manager.reserve_next().unwrap().unwrap()),
        "later"
    );
    manager.finish_active("missing").unwrap();
}

#[test]
fn shutdown_stops_running_and_paused_encoders_and_clears_the_queue() {
    use crate::jobs::process::RunningProcess;
    use crate::output::partial::create_partial;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    let manager = JobManager::default();
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "vidra-shutdown-processes-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).unwrap();
    let active_output = directory.join("active-vidra.mp4");
    let paused_output = directory.join("paused-vidra.mp4");
    fs::write(&active_output, b"keep active destination").unwrap();
    fs::write(&paused_output, b"keep paused destination").unwrap();
    let active_partial = create_partial(&active_output, "active", "mp4", &[], &[]).unwrap();
    let paused_partial = create_partial(&paused_output, "paused", "mp4", &[], &[]).unwrap();
    fs::write(&active_partial.path, b"active partial").unwrap();
    fs::write(&paused_partial.path, b"paused partial").unwrap();
    let stops = Arc::new(AtomicUsize::new(0));
    let active_stops = Arc::clone(&stops);
    let paused_stops = Arc::clone(&stops);
    manager.append(vec![pending("waiting")]).unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.active = Some(ActiveJob {
            id: "active".to_owned(),
            output_path: active_output.to_string_lossy().into_owned(),
            estimated_output_bytes: 0,
            process: Some(RunningProcess::from_stop(11, move || {
                active_stops.fetch_add(1, Ordering::Relaxed);
                Ok(())
            })),
            process_id: Some(11),
            paused: false,
            partial: Some(active_partial.clone()),
        });
        state.suspended.push_back(ActiveJob {
            id: "paused".to_owned(),
            output_path: paused_output.to_string_lossy().into_owned(),
            estimated_output_bytes: 0,
            process: Some(RunningProcess::from_stop(12, move || {
                paused_stops.fetch_add(1, Ordering::Relaxed);
                Ok(())
            })),
            process_id: Some(12),
            paused: true,
            partial: Some(paused_partial.clone()),
        });
        state.waiting_order.push_front("paused".to_owned());
        state.cancelled.insert("old".to_owned());
        state.update_in_progress = true;
    }

    manager.shutdown();

    assert_eq!(stops.load(Ordering::Relaxed), 2);
    assert_eq!(
        fs::read(&active_output).unwrap(),
        b"keep active destination"
    );
    assert_eq!(
        fs::read(&paused_output).unwrap(),
        b"keep paused destination"
    );
    assert!(!active_partial.path.exists());
    assert!(!paused_partial.path.exists());
    let state = manager.state.lock().unwrap();
    assert!(state.active.is_none());
    assert!(state.suspended.is_empty());
    assert!(state.pending.is_empty());
    assert!(state.waiting_order.is_empty());
    assert!(state.cancelled.is_empty());
    assert!(!state.update_in_progress);
    drop(state);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn shutdown_recovers_a_poisoned_lock_and_still_stops_the_encoder() {
    use crate::jobs::process::RunningProcess;
    use crate::output::partial::create_partial;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    let manager = JobManager::default();
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "vidra-shutdown-poison-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).unwrap();
    let output = directory.join("holiday-vidra.mp4");
    fs::write(&output, b"keep destination").unwrap();
    let partial = create_partial(&output, "active", "mp4", &[], &[]).unwrap();
    fs::write(&partial.path, b"unfinished").unwrap();
    let stopped = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stopped);
    manager.append(vec![pending("waiting")]).unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.active = Some(ActiveJob {
            id: "active".to_owned(),
            output_path: output.to_string_lossy().into_owned(),
            estimated_output_bytes: 0,
            process: Some(RunningProcess::from_stop(7, move || {
                flag.store(true, Ordering::Relaxed);
                Ok(())
            })),
            process_id: Some(7),
            paused: false,
            partial: Some(partial.clone()),
        });
        state.cancelled.insert("old".to_owned());
        state.update_in_progress = true;
    }
    manager.sleep_preventer.activate().unwrap();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = manager.state.lock().unwrap();
        panic!("poison the queue lock");
    }));

    manager.shutdown();

    assert!(stopped.load(Ordering::Relaxed));
    assert_eq!(fs::read(&output).unwrap(), b"keep destination");
    assert!(!partial.path.exists());
    assert!(!manager.sleep_preventer.is_active());
    let state = manager
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    assert!(state.active.is_none());
    assert!(state.pending.is_empty());
    assert!(state.waiting_order.is_empty());
    assert!(state.cancelled.is_empty());
    assert!(!state.update_in_progress);
    drop(state);
    fs::remove_dir_all(directory).unwrap();
}
