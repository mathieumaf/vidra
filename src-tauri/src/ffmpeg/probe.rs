use super::{validate_input, AudioStream, MediaInfo, VideoStream};
use crate::error::{ApiError, ApiResult};
use serde::Deserialize;
use std::{collections::HashMap, path::Path};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    format: ProbeFormat,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    #[serde(default)]
    format_name: String,
    duration: Option<String>,
    size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    pix_fmt: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    bit_rate: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
    #[serde(default)]
    side_data_list: Vec<ProbeSideData>,
}

#[derive(Debug, Deserialize)]
struct ProbeSideData {
    rotation: Option<i32>,
}

fn parse_frame_rate(value: Option<&str>) -> Option<f64> {
    let value = value?;
    let (numerator, denominator) = value.split_once('/')?;
    let numerator = numerator.parse::<f64>().ok()?;
    let denominator = denominator.parse::<f64>().ok()?;

    if denominator == 0.0 {
        None
    } else {
        Some(numerator / denominator)
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown media")
        .to_owned()
}

fn display_dimensions(stream: &ProbeStream) -> (u32, u32) {
    let width = stream.width.unwrap_or_default();
    let height = stream.height.unwrap_or_default();
    let rotation = stream
        .side_data_list
        .iter()
        .find_map(|side_data| side_data.rotation)
        .or_else(|| {
            stream
                .tags
                .get("rotate")
                .and_then(|value| value.parse().ok())
        });
    if rotation.is_some_and(|degrees| degrees.rem_euclid(180) == 90) {
        (height, width)
    } else {
        (width, height)
    }
}

pub async fn media(app: &AppHandle, path: &str) -> ApiResult<MediaInfo> {
    let input = validate_input(path)?;
    let input_argument = input.as_os_str();
    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
        ])
        .arg(input_argument)
        .output()
        .await
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?;

    if !output.status.success() {
        return Err(ApiError::ffmpeg(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }

    let probe: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|error| ApiError::ffmpeg(format!("Unable to parse FFprobe output: {error}")))?;

    let video = probe
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
        .map(|stream| {
            let (width, height) = display_dimensions(stream);
            VideoStream {
                codec: stream
                    .codec_name
                    .clone()
                    .unwrap_or_else(|| "unknown".into()),
                width,
                height,
                frame_rate: parse_frame_rate(stream.avg_frame_rate.as_deref()),
                pixel_format: stream.pix_fmt.clone(),
            }
        });

    let audio = probe
        .streams
        .iter()
        .filter(|stream| stream.codec_type.as_deref() == Some("audio"))
        .map(|stream| AudioStream {
            codec: stream
                .codec_name
                .clone()
                .unwrap_or_else(|| "unknown".into()),
            channels: stream.channels,
            sample_rate: stream
                .sample_rate
                .as_deref()
                .and_then(|value| value.parse().ok()),
            bit_rate: stream
                .bit_rate
                .as_deref()
                .and_then(|value| value.parse().ok()),
            language: stream.tags.get("language").cloned(),
        })
        .collect();

    Ok(MediaInfo {
        path: input.to_string_lossy().into_owned(),
        name: display_name(&input),
        duration_seconds: probe
            .format
            .duration
            .as_deref()
            .and_then(|value| value.parse().ok())
            .unwrap_or_default(),
        size_bytes: probe
            .format
            .size
            .as_deref()
            .and_then(|value| value.parse().ok())
            .unwrap_or_default(),
        format_name: probe.format.format_name,
        video,
        audio,
    })
}

#[cfg(test)]
mod tests {
    use super::{display_dimensions, parse_frame_rate, ProbeSideData, ProbeStream};
    use std::collections::HashMap;

    #[test]
    fn parses_fractional_frame_rates() {
        assert_eq!(parse_frame_rate(Some("30000/1001")), Some(30000.0 / 1001.0));
        assert_eq!(parse_frame_rate(Some("0/0")), None);
        assert_eq!(parse_frame_rate(None), None);
    }

    #[test]
    fn reports_dimensions_in_display_orientation() {
        let stream = ProbeStream {
            codec_type: Some("video".to_owned()),
            codec_name: Some("h264".to_owned()),
            width: Some(1920),
            height: Some(1080),
            avg_frame_rate: None,
            pix_fmt: None,
            channels: None,
            sample_rate: None,
            bit_rate: None,
            tags: HashMap::new(),
            side_data_list: vec![ProbeSideData {
                rotation: Some(-90),
            }],
        };

        assert_eq!(display_dimensions(&stream), (1080, 1920));
    }
}
