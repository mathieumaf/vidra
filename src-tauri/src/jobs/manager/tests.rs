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
            child: None,
            process_id: None,
            paused: false,
        });
    }

    manager.shutdown();

    assert!(!output.exists());
    let state = manager.state.lock().unwrap();
    assert!(state.active.is_none());
    assert!(state.suspended.is_empty());
    assert!(state.pending.is_empty());
    assert!(state.waiting_order.is_empty());
}
