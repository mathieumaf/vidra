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
    pub format_long_name: Option<String>,
    pub video: Option<VideoStream>,
    pub audio: Vec<AudioStream>,
    pub subtitles: Vec<SubtitleStream>,
    pub chapter_count: usize,
    pub has_metadata: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub pixel_format: Option<String>,
    pub bit_depth: Option<u8>,
    pub color_range: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub hdr_format: Option<HdrFormat>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HdrFormat {
    DolbyVision,
    Hdr10Plus,
    Hdr10,
    Hlg,
    Pq,
    Hdr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub index: u32,
    pub codec: String,
    pub channels: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_rate: Option<u64>,
    pub language: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStream {
    pub index: u32,
    pub codec: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
    pub is_forced: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QualityLevel {
    MaximumCompression,
    SmallerFile,
    Balanced,
    HighQuality,
    NearSource,
}

impl QualityLevel {
    pub fn crf(self, codec: VideoCodec) -> Option<u8> {
        match (codec, self) {
            (VideoCodec::H264, Self::MaximumCompression) => Some(30),
            (VideoCodec::H264, Self::SmallerFile) => Some(26),
            (VideoCodec::H264, Self::Balanced) => Some(22),
            (VideoCodec::H264, Self::HighQuality) => Some(19),
            (VideoCodec::H264, Self::NearSource) => Some(17),
            (VideoCodec::H265, Self::MaximumCompression) => Some(34),
            (VideoCodec::H265, Self::SmallerFile) => Some(30),
            (VideoCodec::H265, Self::Balanced) => Some(26),
            (VideoCodec::H265, Self::HighQuality) => Some(23),
            (VideoCodec::H265, Self::NearSource) => Some(21),
            (VideoCodec::Av1, Self::MaximumCompression) => Some(45),
            (VideoCodec::Av1, Self::SmallerFile) => Some(39),
            (VideoCodec::Av1, Self::Balanced) => Some(33),
            (VideoCodec::Av1, Self::HighQuality) => Some(27),
            (VideoCodec::Av1, Self::NearSource) => Some(23),
            (VideoCodec::Copy, _) => None,
        }
    }

    pub fn videotoolbox_quality(self) -> u8 {
        match self {
            Self::MaximumCompression => 35,
            Self::SmallerFile => 50,
            Self::Balanced => 65,
            Self::HighQuality => 80,
            Self::NearSource => 90,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    Copy,
    H264,
    H265,
    Av1,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EncodingSpeed {
    Efficient,
    Fast,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioMode {
    Auto,
    Copy,
    Aac,
    Opus,
    None,
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum OutputResolution {
    #[default]
    #[serde(rename = "source")]
    Source,
    #[serde(rename = "2160p")]
    P2160,
    #[serde(rename = "1440p")]
    P1440,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "480p")]
    P480,
    #[serde(rename = "360p")]
    P360,
}

impl OutputResolution {
    pub fn landscape_bounds(self) -> Option<(u32, u32)> {
        match self {
            Self::Source => None,
            Self::P2160 => Some((3840, 2160)),
            Self::P1440 => Some((2560, 1440)),
            Self::P1080 => Some((1920, 1080)),
            Self::P720 => Some((1280, 720)),
            Self::P480 => Some((854, 480)),
            Self::P360 => Some((640, 360)),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum OutputFrameRate {
    #[default]
    #[serde(rename = "source")]
    Source,
    #[serde(rename = "24")]
    Fps24,
    #[serde(rename = "25")]
    Fps25,
    #[serde(rename = "30")]
    Fps30,
    #[serde(rename = "50")]
    Fps50,
    #[serde(rename = "60")]
    Fps60,
}

impl OutputFrameRate {
    pub fn value(self) -> Option<u32> {
        match self {
            Self::Source => None,
            Self::Fps24 => Some(24),
            Self::Fps25 => Some(25),
            Self::Fps30 => Some(30),
            Self::Fps50 => Some(50),
            Self::Fps60 => Some(60),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum AudioBitrate {
    #[default]
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "96")]
    Kbps96,
    #[serde(rename = "128")]
    Kbps128,
    #[serde(rename = "160")]
    Kbps160,
    #[serde(rename = "192")]
    Kbps192,
    #[serde(rename = "256")]
    Kbps256,
}

impl AudioBitrate {
    pub fn bits_per_second(self) -> Option<u64> {
        match self {
            Self::Auto => None,
            Self::Kbps96 => Some(96_000),
            Self::Kbps128 => Some(128_000),
            Self::Kbps160 => Some(160_000),
            Self::Kbps192 => Some(192_000),
            Self::Kbps256 => Some(256_000),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioChannels {
    #[default]
    Source,
    Stereo,
    Mono,
}

impl AudioChannels {
    pub fn maximum(self) -> Option<u32> {
        match self {
            Self::Source => None,
            Self::Stereo => Some(2),
            Self::Mono => Some(1),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioTrackMode {
    #[default]
    All,
    First,
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
    pub output_resolution: OutputResolution,
    pub output_frame_rate: OutputFrameRate,
    pub quality_tuning: i8,
    pub audio_bitrate: AudioBitrate,
    pub audio_channels: AudioChannels,
    pub audio_track_mode: AudioTrackMode,
    pub audio_stream_indexes: Vec<u32>,
    pub subtitle_stream_indexes: Vec<u32>,
    pub preserve_subtitles: bool,
    pub preserve_metadata: bool,
    pub preserve_chapters: bool,
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
