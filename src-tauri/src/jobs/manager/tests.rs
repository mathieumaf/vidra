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
            child: None,
            process_id: None,
            paused: true,
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
            child: None,
            process_id: None,
            paused,
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
    let mut process = Command::new("sleep").arg("30").spawn().unwrap();
    let process_id = process.id();
    manager.sleep_preventer.activate().unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.active = Some(ActiveJob {
            id: "active".to_owned(),
            output_path: "/active.mp4".to_owned(),
            estimated_output_bytes: 0,
            child: None,
            process_id: Some(process_id),
            paused: false,
        });
    }

    manager.set_paused("active", true).unwrap();
    assert!(!manager.sleep_preventer.is_active());

    manager.set_paused("active", false).unwrap();
    assert!(manager.sleep_preventer.is_active());

    manager.finish_active("active").unwrap();
    assert!(!manager.sleep_preventer.is_active());
    process.kill().unwrap();
    process.wait().unwrap();
}

#[test]
fn shutdown_removes_incomplete_outputs_and_clears_the_queue() {
    let manager = JobManager::default();
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let output = std::env::temp_dir().join(format!(
        "vidra-shutdown-test-{}-{unique}.mp4",
        std::process::id()
    ));
    fs::write(&output, b"partial output").unwrap();
    manager.append(vec![pending("waiting")]).unwrap();
    {
        let mut state = manager.state.lock().unwrap();
        state.active = Some(ActiveJob {
            id: "active".to_owned(),
            output_path: output.to_string_lossy().into_owned(),
            estimated_output_bytes: 0,
            child: None,
            process_id: None,
            paused: false,
        });
    }
    manager.sleep_preventer.activate().unwrap();
    assert!(manager.sleep_preventer.is_active());

    manager.shutdown();

    assert!(!output.exists());
    assert!(!manager.sleep_preventer.is_active());
    let state = manager.state.lock().unwrap();
    assert!(state.active.is_none());
    assert!(state.suspended.is_empty());
    assert!(state.pending.is_empty());
    assert!(state.waiting_order.is_empty());
}
