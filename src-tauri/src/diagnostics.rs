use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::MediaInfo,
    jobs::PendingJob,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

const MAX_LOG_BYTES: usize = 32 * 1024;
const MAX_REPORT_BYTES: usize = 48 * 1024;
const TRUNCATION_NOTICE: &str = "[Earlier FFmpeg output was omitted.]\n";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub code: String,
    pub summary: String,
    pub report: String,
}

#[derive(Debug, Default)]
pub struct BoundedLog {
    contents: String,
    truncated: bool,
}

impl BoundedLog {
    pub fn push(&mut self, value: &str) {
        self.contents.push_str(value);
        if self.contents.len() <= MAX_LOG_BYTES {
            return;
        }

        let mut start = self.contents.len() - MAX_LOG_BYTES;
        while !self.contents.is_char_boundary(start) {
            start += 1;
        }
        self.contents.drain(..start);
        self.truncated = true;
    }

    fn finish(self) -> String {
        if self.truncated {
            format!("{TRUNCATION_NOTICE}{}", self.contents)
        } else {
            self.contents
        }
    }
}

pub fn failure_report(
    job: &PendingJob,
    log: BoundedLog,
    exit_code: Option<i32>,
) -> DiagnosticReport {
    let raw_log = log.finish();
    let (code, summary) = classify_failure(&raw_log);
    let redacted_log = redact_paths(&raw_log, job);
    let command = crate::ffmpeg::encode::redacted_command(job)
        .unwrap_or_else(|_| "ffmpeg <command unavailable>".to_owned());
    let report = format!(
        "Vidra diagnostic report\n\
         Privacy: source and output paths are redacted.\n\n\
         Failure\n\
         Code: {code}\n\
         Summary: {summary}\n\
         Exit code: {}\n\n\
         Environment\n\
         Vidra: {}\n\
         Platform: {} ({})\n\
         FFmpeg: {}\n\n\
         Source\n{}\n\n\
         Settings\n{}\n\n\
         Command\n{command}\n\n\
         FFmpeg output\n{}",
        exit_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "Unavailable".to_owned()),
        env!("CARGO_PKG_VERSION"),
        platform_name(),
        std::env::consts::ARCH,
        job.ffmpeg_version.as_deref().unwrap_or("Unavailable"),
        source_summary(&job.media),
        settings_summary(job),
        if redacted_log.trim().is_empty() {
            "No FFmpeg output was captured."
        } else {
            redacted_log.trim()
        },
    );

    DiagnosticReport {
        code: code.to_owned(),
        summary: summary.to_owned(),
        report: truncate_report(report),
    }
}

pub fn save_report(path: &str, report: &str) -> ApiResult<()> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(ApiError::invalid_input(
            "The diagnostic report path must be absolute.",
        ));
    }
    if report.is_empty() || report.len() > MAX_REPORT_BYTES {
        return Err(ApiError::invalid_input(
            "The diagnostic report is empty or too large to save.",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::invalid_input("The diagnostic report folder is unavailable."))?;
    if !parent.is_dir() {
        return Err(ApiError::invalid_input(
            "The diagnostic report folder does not exist.",
        ));
    }
    fs::write(path, report).map_err(|error| {
        ApiError::new(
            "diagnostic_write_error",
            format!("Unable to save the diagnostic report: {error}"),
        )
    })
}

fn classify_failure(log: &str) -> (&'static str, &'static str) {
    let log = log.to_ascii_lowercase();
    if contains_any(&log, &["no space left on device", "disk full"]) {
        return (
            "disk_full",
            "The destination does not have enough free space.",
        );
    }
    if contains_any(
        &log,
        &[
            "permission denied",
            "operation not permitted",
            "read-only file system",
        ],
    ) {
        return (
            "permission_denied",
            "Vidra does not have permission to read the source or write the output.",
        );
    }
    if contains_any(
        &log,
        &[
            "unknown encoder",
            "encoder not found",
            "error while opening encoder",
            "cannot load lib",
            "videotoolbox session",
        ],
    ) {
        return (
            "encoder_unavailable",
            "The selected video encoder could not be started.",
        );
    }
    if contains_any(
        &log,
        &[
            "invalid data found when processing input",
            "could not find codec parameters",
            "moov atom not found",
            "unsupported codec",
            "error while decoding",
        ],
    ) {
        return (
            "unsupported_media",
            "FFmpeg could not read or decode this source.",
        );
    }
    if contains_any(
        &log,
        &[
            "could not write header",
            "not a suitable output format",
            "codec not currently supported in container",
        ],
    ) {
        return (
            "incompatible_output",
            "The selected output settings are not compatible with this media.",
        );
    }
    (
        "ffmpeg_failure",
        "FFmpeg could not complete this conversion.",
    )
}

fn contains_any(value: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| value.contains(pattern))
}

fn redact_paths(value: &str, job: &PendingJob) -> String {
    let redacted = value
        .replace(&job.request.input_path, "<source>")
        .replace(&job.request.output_path, "<output>");
    let Some(home) = std::env::var_os("HOME") else {
        return redacted;
    };
    let home = home.to_string_lossy();
    if home.is_empty() {
        redacted
    } else {
        redacted.replace(home.as_ref(), "<home>")
    }
}

fn source_summary(media: &MediaInfo) -> String {
    let video = media.video.as_ref().map_or_else(
        || "Video: none".to_owned(),
        |video| {
            format!(
                "Video: {} · {}x{} · {} · {}-bit · HDR {}",
                video.codec,
                video.width,
                video.height,
                video
                    .pixel_format
                    .as_deref()
                    .unwrap_or("unknown pixel format"),
                video
                    .bit_depth
                    .map(|depth| depth.to_string())
                    .unwrap_or_else(|| "unknown".to_owned()),
                video
                    .hdr_format
                    .map(|format| format!("{format:?}"))
                    .unwrap_or_else(|| "none detected".to_owned()),
            )
        },
    );
    format!(
        "Container: {}\nDuration: {:.3} seconds\nSize: {} bytes\n{}\nAudio tracks: {}\nSubtitle tracks: {}\nChapters: {}",
        media.format_name,
        media.duration_seconds,
        media.size_bytes,
        video,
        media.audio.len(),
        media.subtitles.len(),
        media.chapter_count,
    )
}

fn settings_summary(job: &PendingJob) -> String {
    let request = &job.request;
    format!(
        "Container: {:?}\nVideo codec: {:?}\nEncoding: {:?}\nQuality: {:?} (tuning {})\nResolution: {:?}\nFrame rate: {:?}\nAudio: {:?} · {:?} · {:?}\nSelected tracks: {} audio · {} subtitles\nPreserve: metadata {} · chapters {} · subtitles {}",
        request.container,
        request.video_codec,
        request.encoding_speed,
        request.quality,
        request.quality_tuning,
        request.output_resolution,
        request.output_frame_rate,
        request.audio_mode,
        request.audio_bitrate,
        request.audio_channels,
        request.audio_stream_indexes.len(),
        request.subtitle_stream_indexes.len(),
        request.preserve_metadata,
        request.preserve_chapters,
        request.preserve_subtitles,
    )
}

fn truncate_report(mut report: String) -> String {
    if report.len() <= MAX_REPORT_BYTES {
        return report;
    }
    const NOTICE: &str = "\n[Diagnostic report truncated.]\n";
    let mut end = MAX_REPORT_BYTES - NOTICE.len();
    while !report.is_char_boundary(end) {
        end -= 1;
    }
    report.truncate(end);
    report.push_str(NOTICE);
    report
}

fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        value => value,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_failure, failure_report, save_report, truncate_report, BoundedLog, MAX_LOG_BYTES,
        MAX_REPORT_BYTES,
    };
    use crate::{
        ffmpeg::{
            AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodeRequest, EncodingSpeed,
            MediaInfo, OutputContainer, OutputFrameRate, OutputResolution, QualityLevel,
            VideoCodec,
        },
        jobs::PendingJob,
    };
    use std::fs;

    fn pending_job() -> PendingJob {
        PendingJob {
            id: "diagnostic-test".to_owned(),
            request: EncodeRequest {
                input_path: "/Users/private/Videos/source.mov".to_owned(),
                output_path: "/Users/private/Exports/output.mp4".to_owned(),
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
                path: "/Users/private/Videos/source.mov".to_owned(),
                name: "source.mov".to_owned(),
                duration_seconds: 12.5,
                size_bytes: 1_024,
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

    #[test]
    fn classifies_common_failures() {
        assert_eq!(
            classify_failure("write failed: No space left on device").0,
            "disk_full"
        );
        assert_eq!(
            classify_failure("/output.mp4: Permission denied").0,
            "permission_denied"
        );
        assert_eq!(
            classify_failure("Unknown encoder 'missing'").0,
            "encoder_unavailable"
        );
        assert_eq!(classify_failure("unexpected failure").0, "ffmpeg_failure");
    }

    #[test]
    fn log_keeps_a_bounded_utf8_tail() {
        let mut log = BoundedLog::default();
        log.push(&"old🙂".repeat(MAX_LOG_BYTES));
        log.push("final cause");

        let value = log.finish();
        assert!(value.starts_with("[Earlier FFmpeg output was omitted.]"));
        assert!(value.ends_with("final cause"));
        assert!(value.len() <= MAX_LOG_BYTES + 64);
    }

    #[test]
    fn reports_are_bounded_and_redact_media_paths() {
        let job = pending_job();
        let mut log = BoundedLog::default();
        log.push(&format!(
            "{}: Permission denied while writing {}",
            job.request.input_path, job.request.output_path
        ));

        let diagnostic = failure_report(&job, log, Some(1));

        assert_eq!(diagnostic.code, "permission_denied");
        assert!(!diagnostic.report.contains(&job.request.input_path));
        assert!(!diagnostic.report.contains(&job.request.output_path));
        assert!(!diagnostic.report.contains("/Users/private"));
        assert!(diagnostic.report.contains("ffmpeg -hide_banner"));
        assert!(diagnostic.report.contains("<source>"));
        assert!(diagnostic.report.contains("<output>"));
        assert!(diagnostic.report.len() <= MAX_REPORT_BYTES);
    }

    #[test]
    fn report_truncation_respects_the_save_limit_and_utf8_boundaries() {
        let report = truncate_report("🙂".repeat(MAX_REPORT_BYTES));

        assert!(report.len() <= MAX_REPORT_BYTES);
        assert!(report.ends_with("[Diagnostic report truncated.]\n"));
    }

    #[test]
    fn saving_reports_requires_an_absolute_existing_destination() {
        assert!(save_report("report.txt", "diagnostic").is_err());

        let directory =
            std::env::temp_dir().join(format!("vidra-diagnostic-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("report.txt");

        save_report(path.to_str().unwrap(), "diagnostic").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "diagnostic");
        fs::remove_dir_all(directory).unwrap();
    }
}
