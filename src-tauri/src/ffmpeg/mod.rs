pub mod binary;
pub mod encode;
pub mod probe;
mod progress;

use crate::error::{ApiError, ApiResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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
    pub fn crf(self, codec: VideoCodec) -> &'static str {
        match (codec, self) {
            (VideoCodec::H264, Self::MaximumCompression) => "30",
            (VideoCodec::H264, Self::SmallerFile) => "26",
            (VideoCodec::H264, Self::Balanced) => "22",
            (VideoCodec::H264, Self::HighQuality) => "19",
            (VideoCodec::H264, Self::NearSource) => "17",
            (VideoCodec::H265, Self::MaximumCompression) => "34",
            (VideoCodec::H265, Self::SmallerFile) => "30",
            (VideoCodec::H265, Self::Balanced) => "26",
            (VideoCodec::H265, Self::HighQuality) => "23",
            (VideoCodec::H265, Self::NearSource) => "21",
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
    fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mkv => "mkv",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    H264,
    H265,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeRequest {
    pub input_path: String,
    pub output_path: String,
    pub quality: QualityLevel,
    pub container: OutputContainer,
    pub video_codec: VideoCodec,
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

fn validate_input(path: &str) -> ApiResult<PathBuf> {
    let input = Path::new(path);
    if !input.is_absolute() {
        return Err(ApiError::invalid_input("The input path must be absolute."));
    }

    let canonical = input
        .canonicalize()
        .map_err(|_| ApiError::invalid_input("The selected input file is not accessible."))?;

    if !canonical.is_file() {
        return Err(ApiError::invalid_input("The selected input is not a file."));
    }

    Ok(canonical)
}

fn validate_output(path: &str, input: &Path, container: OutputContainer) -> ApiResult<PathBuf> {
    let output = PathBuf::from(path);
    if !output.is_absolute() {
        return Err(ApiError::invalid_input("The output path must be absolute."));
    }

    let extension_matches = output
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(container.extension()));

    if !extension_matches {
        return Err(ApiError::invalid_input(format!(
            "The selected container requires a .{} output.",
            container.extension()
        )));
    }

    let parent = output
        .parent()
        .ok_or_else(|| ApiError::invalid_input("The output directory is invalid."))?;

    if !parent.is_dir() {
        return Err(ApiError::invalid_input(
            "The output directory does not exist.",
        ));
    }

    if output == input {
        return Err(ApiError::invalid_input(
            "The output file must be different from the input file.",
        ));
    }

    Ok(output)
}
