use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub ready: bool,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub format_name: String,
    pub video: Option<VideoStream>,
    pub audio: Vec<AudioStream>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub pixel_format: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub codec: String,
    pub channels: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_rate: Option<u64>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QualityLevel {
    MaximumCompression,
    SmallerFile,
    Balanced,
    HighQuality,
    NearSource,
}

impl QualityLevel {
    pub fn crf(self, codec: VideoCodec) -> Option<&'static str> {
        match (codec, self) {
            (VideoCodec::H264, Self::MaximumCompression) => Some("30"),
            (VideoCodec::H264, Self::SmallerFile) => Some("26"),
            (VideoCodec::H264, Self::Balanced) => Some("22"),
            (VideoCodec::H264, Self::HighQuality) => Some("19"),
            (VideoCodec::H264, Self::NearSource) => Some("17"),
            (VideoCodec::H265, Self::MaximumCompression) => Some("34"),
            (VideoCodec::H265, Self::SmallerFile) => Some("30"),
            (VideoCodec::H265, Self::Balanced) => Some("26"),
            (VideoCodec::H265, Self::HighQuality) => Some("23"),
            (VideoCodec::H265, Self::NearSource) => Some("21"),
            (VideoCodec::Av1, Self::MaximumCompression) => Some("45"),
            (VideoCodec::Av1, Self::SmallerFile) => Some("39"),
            (VideoCodec::Av1, Self::Balanced) => Some("33"),
            (VideoCodec::Av1, Self::HighQuality) => Some("27"),
            (VideoCodec::Av1, Self::NearSource) => Some("23"),
            (VideoCodec::Copy, _) => None,
        }
    }

    pub fn videotoolbox_quality(self) -> &'static str {
        match self {
            Self::MaximumCompression => "35",
            Self::SmallerFile => "50",
            Self::Balanced => "65",
            Self::HighQuality => "80",
            Self::NearSource => "90",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OutputContainer {
    Mp4,
    Mkv,
}

impl OutputContainer {
    pub(super) fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mkv => "mkv",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    Copy,
    H264,
    H265,
    Av1,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EncodingSpeed {
    Efficient,
    Fast,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioMode {
    Auto,
    Copy,
    Aac,
    Opus,
    None,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeRequest {
    pub input_path: String,
    pub output_path: String,
    pub quality: QualityLevel,
    pub container: OutputContainer,
    pub video_codec: VideoCodec,
    pub encoding_speed: EncodingSpeed,
    pub audio_mode: AudioMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeProgress {
    pub job_id: String,
    pub percent: f64,
    pub out_time_seconds: f64,
    pub speed: Option<String>,
    pub eta_seconds: Option<f64>,
    pub frame: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeFinished {
    pub job_id: String,
    pub status: String,
    pub output_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedEncode {
    pub job_id: String,
    pub input_path: String,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeStarted {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodePauseChanged {
    pub job_id: String,
    pub paused: bool,
}
