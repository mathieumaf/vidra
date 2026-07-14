use crate::{
    ffmpeg::{
        AudioMode, EncodingSpeed, OutputContainer, OutputResolution, QualityLevel, VideoCodec,
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
            },
        }
    }
}
