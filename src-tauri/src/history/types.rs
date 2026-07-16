use crate::{
    diagnostics::DiagnosticReport,
    ffmpeg::{
        AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodingSpeed, OutputContainer,
        OutputFrameRate, OutputResolution, QualityLevel, VideoCodec,
    },
    jobs::PendingJob,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HistoryStatus {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistorySettings {
    pub quality: QualityLevel,
    pub container: OutputContainer,
    pub video_codec: VideoCodec,
    pub encoding_speed: EncodingSpeed,
    pub audio_mode: AudioMode,
    #[serde(default)]
    pub output_resolution: OutputResolution,
    #[serde(default)]
    pub output_frame_rate: OutputFrameRate,
    #[serde(default)]
    pub quality_tuning: i8,
    #[serde(default)]
    pub audio_bitrate: AudioBitrate,
    #[serde(default)]
    pub audio_channels: AudioChannels,
    #[serde(default)]
    pub audio_track_mode: AudioTrackMode,
    #[serde(default = "default_true")]
    pub preserve_subtitles: bool,
    #[serde(default = "default_true")]
    pub preserve_metadata: bool,
    #[serde(default = "default_true")]
    pub preserve_chapters: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub source_path: String,
    pub source_name: String,
    pub output_path: String,
    pub status: HistoryStatus,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub media_duration_seconds: f64,
    pub source_size_bytes: u64,
    pub output_size_bytes: Option<u64>,
    pub settings: HistorySettings,
    pub error: Option<String>,
    #[serde(default)]
    pub diagnostic: Option<DiagnosticReport>,
}

#[derive(Debug, Clone)]
pub struct HistoryDraft {
    pub job_id: String,
    pub source_path: String,
    pub source_name: String,
    pub output_path: String,
    pub started_at_ms: u64,
    pub media_duration_seconds: f64,
    pub source_size_bytes: u64,
    pub settings: HistorySettings,
}

impl HistoryDraft {
    pub fn from_job(job: &PendingJob, started_at_ms: u64) -> Self {
        Self {
            job_id: job.id.clone(),
            source_path: job.request.input_path.clone(),
            source_name: job.media.name.clone(),
            output_path: job.request.output_path.clone(),
            started_at_ms,
            media_duration_seconds: job.media.duration_seconds,
            source_size_bytes: job.media.size_bytes,
            settings: HistorySettings {
                quality: job.request.quality,
                container: job.request.container,
                video_codec: job.request.video_codec,
                encoding_speed: job.request.encoding_speed,
                audio_mode: job.request.audio_mode,
                output_resolution: job.request.output_resolution,
                output_frame_rate: job.request.output_frame_rate,
                quality_tuning: job.request.quality_tuning,
                audio_bitrate: job.request.audio_bitrate,
                audio_channels: job.request.audio_channels,
                audio_track_mode: job.request.audio_track_mode,
                preserve_subtitles: job.request.preserve_subtitles,
                preserve_metadata: job.request.preserve_metadata,
                preserve_chapters: job.request.preserve_chapters,
            },
        }
    }
}
