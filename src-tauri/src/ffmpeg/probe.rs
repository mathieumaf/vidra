use super::{validate_input, AudioStream, MediaInfo, SubtitleStream, VideoStream};
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
    #[serde(default)]
    chapters: Vec<ProbeChapter>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    #[serde(default)]
    format_name: String,
    format_long_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct ProbeChapter {}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    index: u32,
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
    disposition: ProbeDisposition,
    #[serde(default)]
    side_data_list: Vec<ProbeSideData>,
}

#[derive(Debug, Default, Deserialize)]
struct ProbeDisposition {
    #[serde(default, rename = "default")]
    is_default: u8,
    #[serde(default)]
    forced: u8,
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
            "-show_chapters",
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

    parse_media_info(&output.stdout, &input)
}

fn parse_media_info(output: &[u8], input: &Path) -> ApiResult<MediaInfo> {
    let probe: ProbeOutput = serde_json::from_slice(output)
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
            index: stream.index,
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
            title: stream.tags.get("title").cloned(),
        })
        .collect();

    let subtitles = probe
        .streams
        .iter()
        .filter(|stream| stream.codec_type.as_deref() == Some("subtitle"))
        .map(|stream| SubtitleStream {
            index: stream.index,
            codec: stream
                .codec_name
                .clone()
                .unwrap_or_else(|| "unknown".into()),
            language: stream.tags.get("language").cloned(),
            title: stream.tags.get("title").cloned(),
            is_default: stream.disposition.is_default != 0,
            is_forced: stream.disposition.forced != 0,
        })
        .collect();

    Ok(MediaInfo {
        path: input.to_string_lossy().into_owned(),
        name: display_name(input),
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
        format_long_name: probe.format.format_long_name,
        video,
        audio,
        subtitles,
        chapter_count: probe.chapters.len(),
        has_metadata: !probe.format.tags.is_empty(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        display_dimensions, parse_frame_rate, parse_media_info, ProbeDisposition, ProbeSideData,
        ProbeStream,
    };
    use std::{collections::HashMap, path::Path};

    #[test]
    fn parses_fractional_frame_rates() {
        assert_eq!(parse_frame_rate(Some("30000/1001")), Some(30000.0 / 1001.0));
        assert_eq!(parse_frame_rate(Some("0/0")), None);
        assert_eq!(parse_frame_rate(None), None);
    }

    #[test]
    fn reports_dimensions_in_display_orientation() {
        let stream = ProbeStream {
            index: 0,
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
            disposition: ProbeDisposition::default(),
            side_data_list: vec![ProbeSideData {
                rotation: Some(-90),
            }],
        };

        assert_eq!(display_dimensions(&stream), (1080, 1920));
    }

    #[test]
    fn parses_media_details() {
        let output = br#"{
          "streams": [
            {
              "index": 0,
              "codec_name": "hevc",
              "codec_type": "video",
              "width": 3840,
              "height": 2160,
              "avg_frame_rate": "24000/1001",
              "pix_fmt": "yuv420p10le"
            },
            {
              "index": 1,
              "codec_name": "aac",
              "codec_type": "audio",
              "sample_rate": "48000",
              "channels": 6,
              "bit_rate": "256000",
              "tags": { "language": "eng", "title": "Surround" }
            },
            {
              "index": 2,
              "codec_name": "subrip",
              "codec_type": "subtitle",
              "disposition": { "default": 1, "forced": 1 },
              "tags": { "language": "fra", "title": "French" }
            }
          ],
          "chapters": [{ "id": 0 }, { "id": 1 }],
          "format": {
            "format_name": "matroska,webm",
            "format_long_name": "Matroska / WebM",
            "duration": "125.5",
            "size": "1048576",
            "tags": { "title": "Example" }
          }
        }"#;

        let media = parse_media_info(output, Path::new("/tmp/example.mkv")).unwrap();

        assert_eq!(media.format_name, "matroska,webm");
        assert_eq!(media.format_long_name.as_deref(), Some("Matroska / WebM"));
        assert_eq!(media.chapter_count, 2);
        assert!(media.has_metadata);
        assert_eq!(
            media.video.unwrap().pixel_format.as_deref(),
            Some("yuv420p10le")
        );
        assert_eq!(media.audio[0].language.as_deref(), Some("eng"));
        assert_eq!(media.audio[0].index, 1);
        assert_eq!(media.audio[0].title.as_deref(), Some("Surround"));
        assert_eq!(media.subtitles[0].codec, "subrip");
        assert_eq!(media.subtitles[0].index, 2);
        assert_eq!(media.subtitles[0].language.as_deref(), Some("fra"));
        assert!(media.subtitles[0].is_default);
        assert!(media.subtitles[0].is_forced);
    }
}
