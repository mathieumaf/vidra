use super::{HistoryDraft, HistoryManager, HistoryStatus};
use crate::ffmpeg::{
    AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodingSpeed, OutputContainer,
    OutputFrameRate, OutputResolution, QualityLevel, VideoCodec,
};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(1);

fn test_directory() -> PathBuf {
    let id = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("vidra-history-test-{}-{id}", std::process::id()))
}

fn draft(id: usize, directory: &std::path::Path) -> HistoryDraft {
    HistoryDraft {
        job_id: format!("job-{id}"),
        source_path: directory
            .join(format!("source-{id}.mov"))
            .to_string_lossy()
            .into_owned(),
        source_name: format!("source-{id}.mov"),
        output_path: directory
            .join(format!("output-{id}.mp4"))
            .to_string_lossy()
            .into_owned(),
        started_at_ms: id as u64,
        media_duration_seconds: 12.5,
        source_size_bytes: 1_024,
        settings: super::types::HistorySettings {
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
            preserve_subtitles: true,
            preserve_metadata: true,
            preserve_chapters: true,
        },
    }
}

#[test]
fn completed_entries_persist_with_the_output_size() {
    let directory = test_directory();
    fs::create_dir_all(&directory).unwrap();
    let history_path = directory.join("history.json");
    let manager = HistoryManager::new(history_path.clone());
    let item = draft(1, &directory);
    fs::write(&item.output_path, b"encoded").unwrap();

    let entry = manager
        .record(item, HistoryStatus::Completed, None)
        .unwrap();

    assert_eq!(entry.output_size_bytes, Some(7));
    assert_eq!(
        HistoryManager::new(history_path).list().unwrap(),
        vec![entry]
    );
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn errors_are_bounded_and_only_keep_the_last_two_lines() {
    let directory = test_directory();
    let manager = HistoryManager::new(directory.join("history.json"));
    let long_line = "x".repeat(600);
    let error = format!("first line\nsecond line\n{long_line}");

    let entry = manager
        .record(draft(1, &directory), HistoryStatus::Failed, Some(&error))
        .unwrap();

    let summary = entry.error.unwrap();
    assert!(summary.starts_with("second line "));
    assert!(summary.ends_with('…'));
    assert!(summary.chars().count() <= 501);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn history_is_limited_to_the_most_recent_entries() {
    let directory = test_directory();
    let manager = HistoryManager::new(directory.join("history.json"));

    for id in 0..=super::manager::MAX_HISTORY_ENTRIES {
        manager
            .record(draft(id, &directory), HistoryStatus::Cancelled, None)
            .unwrap();
    }

    let entries = manager.list().unwrap();
    assert_eq!(entries.len(), super::manager::MAX_HISTORY_ENTRIES);
    assert_eq!(entries[0].source_name, "source-200.mov");
    assert_eq!(entries.last().unwrap().source_name, "source-1.mov");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn invalid_files_are_ignored_and_replaced_on_the_next_write() {
    let directory = test_directory();
    fs::create_dir_all(&directory).unwrap();
    let history_path = directory.join("history.json");
    fs::write(&history_path, b"not json").unwrap();
    let manager = HistoryManager::new(history_path.clone());

    assert!(manager.list().unwrap().is_empty());
    manager
        .record(draft(1, &directory), HistoryStatus::Cancelled, None)
        .unwrap();
    assert_eq!(HistoryManager::new(history_path).list().unwrap().len(), 1);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn history_without_resolution_defaults_to_original() {
    let directory = test_directory();
    fs::create_dir_all(&directory).unwrap();
    let history_path = directory.join("history.json");
    let legacy_history = serde_json::json!({
        "version": 1,
        "entries": [{
            "id": "legacy-entry",
            "sourcePath": "/source.mov",
            "sourceName": "source.mov",
            "outputPath": "/output.mp4",
            "status": "completed",
            "startedAtMs": 1,
            "finishedAtMs": 2,
            "mediaDurationSeconds": 10.0,
            "sourceSizeBytes": 100,
            "outputSizeBytes": 50,
            "settings": {
                "quality": "balanced",
                "container": "mp4",
                "videoCodec": "h264",
                "encodingSpeed": "efficient",
                "audioMode": "auto"
            },
            "error": null
        }]
    });
    fs::write(&history_path, serde_json::to_vec(&legacy_history).unwrap()).unwrap();

    let entries = HistoryManager::new(history_path).list().unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].settings.output_resolution,
        OutputResolution::Source
    );
    assert_eq!(
        entries[0].settings.output_frame_rate,
        OutputFrameRate::Source
    );
    assert!(entries[0].settings.preserve_subtitles);
    assert!(entries[0].settings.preserve_metadata);
    assert!(entries[0].settings.preserve_chapters);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn deleting_or_clearing_history_never_deletes_media() {
    let directory = test_directory();
    fs::create_dir_all(&directory).unwrap();
    let manager = HistoryManager::new(directory.join("history.json"));
    let first = draft(1, &directory);
    let second = draft(2, &directory);
    fs::write(&first.output_path, b"one").unwrap();
    fs::write(&second.output_path, b"two").unwrap();
    let first_entry = manager
        .record(first.clone(), HistoryStatus::Completed, None)
        .unwrap();
    manager
        .record(second.clone(), HistoryStatus::Completed, None)
        .unwrap();

    manager.delete(&first_entry.id).unwrap();
    manager.clear().unwrap();

    assert!(PathBuf::from(first.output_path).is_file());
    assert!(PathBuf::from(second.output_path).is_file());
    assert!(manager.list().unwrap().is_empty());
    fs::remove_dir_all(directory).unwrap();
}
