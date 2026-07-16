use super::{validate_input, AudioStream, HdrFormat, MediaInfo, SubtitleStream, VideoStream};
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
    bits_per_raw_sample: Option<String>,
    color_range: Option<String>,
    color_space: Option<String>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
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
    side_data_type: Option<String>,
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

fn video_bit_depth(stream: &ProbeStream) -> Option<u8> {
    let reported = stream
        .bits_per_raw_sample
        .as_deref()
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| *value > 0);
    reported.or_else(|| pixel_format_bit_depth(stream.pix_fmt.as_deref()?))
}

fn pixel_format_bit_depth(pixel_format: &str) -> Option<u8> {
    let format = pixel_format.to_ascii_lowercase();
    let high_depth_patterns = [
        ("f32", 32),
        ("p016", 16),
        ("p012", 12),
        ("p010", 10),
        ("p16", 16),
        ("p14", 14),
        ("p12", 12),
        ("p10", 10),
        ("p9", 9),
        ("gray16", 16),
        ("gray14", 14),
        ("gray12", 12),
        ("gray10", 10),
        ("gray9", 9),
        ("xyz12", 12),
        ("rgb48", 16),
        ("bgr48", 16),
        ("rgba64", 16),
        ("bgra64", 16),
        ("ayuv64", 16),
        ("rgb10", 10),
        ("bgr10", 10),
        ("y210", 10),
        ("y212", 12),
        ("y410", 10),
        ("y412", 12),
        ("v210", 10),
    ];
    high_depth_patterns
        .iter()
        .find_map(|(pattern, depth)| format.contains(pattern).then_some(*depth))
        .or_else(|| {
            let eight_bit_patterns = [
                "yuv420p", "yuv422p", "yuv444p", "yuva420p", "yuva422p", "yuva444p", "nv12",
                "nv21", "rgb24", "bgr24", "rgba", "bgra", "argb", "abgr", "gray", "pal8",
                "yuyv422", "uyvy422",
            ];
            eight_bit_patterns
                .iter()
                .any(|pattern| format.contains(pattern))
                .then_some(8)
        })
}

fn hdr_format(stream: &ProbeStream) -> Option<HdrFormat> {
    let side_data = stream
        .side_data_list
        .iter()
        .filter_map(|data| data.side_data_type.as_deref())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if side_data.contains("dovi") || side_data.contains("dolby vision") {
        return Some(HdrFormat::DolbyVision);
    }
    if side_data.contains("hdr10+") || side_data.contains("smpte2094-40") {
        return Some(HdrFormat::Hdr10Plus);
    }

    match stream.color_transfer.as_deref() {
        Some("arib-std-b67") => Some(HdrFormat::Hlg),
        Some("smpte2084") if stream.color_primaries.as_deref() == Some("bt2020") => {
            Some(HdrFormat::Hdr10)
        }
        Some("smpte2084") => Some(HdrFormat::Pq),
        _ if side_data.contains("mastering display metadata")
            || side_data.contains("content light level metadata") =>
        {
            Some(HdrFormat::Hdr)
        }
        _ => None,
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
                bit_depth: video_bit_depth(stream),
                color_range: stream.color_range.clone(),
                color_space: stream.color_space.clone(),
                color_transfer: stream.color_transfer.clone(),
                color_primaries: stream.color_primaries.clone(),
                hdr_format: hdr_format(stream),
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
        display_dimensions, hdr_format, parse_frame_rate, parse_media_info, pixel_format_bit_depth,
        video_bit_depth, HdrFormat, ProbeDisposition, ProbeSideData, ProbeStream,
    };
    use std::{collections::HashMap, path::Path};

    #[test]
    fn parses_fractional_frame_rates() {
        assert_eq!(parse_frame_rate(Some("30000/1001")), Some(30000.0 / 1001.0));
        assert_eq!(parse_frame_rate(Some("0/0")), None);
        assert_eq!(parse_frame_rate(None), None);
    }

    #[test]
    fn infers_bit_depth_from_reported_bits_or_pixel_format() {
        let mut stream = probe_video_stream();
        stream.pix_fmt = Some("yuv420p10le".to_owned());
        assert_eq!(video_bit_depth(&stream), Some(10));
        assert_eq!(pixel_format_bit_depth("p012le"), Some(12));
        assert_eq!(pixel_format_bit_depth("unknown-hardware-surface"), None);

        stream.bits_per_raw_sample = Some("12".to_owned());
        assert_eq!(video_bit_depth(&stream), Some(12));
    }

    #[test]
    fn classifies_hlg_and_dolby_vision_sources() {
        let mut stream = probe_video_stream();
        stream.color_transfer = Some("arib-std-b67".to_owned());
        assert_eq!(hdr_format(&stream), Some(HdrFormat::Hlg));

        stream.side_data_list.push(ProbeSideData {
            rotation: None,
            side_data_type: Some("DOVI configuration record".to_owned()),
        });
        assert_eq!(hdr_format(&stream), Some(HdrFormat::DolbyVision));
    }

    #[test]
    fn reports_dimensions_in_display_orientation() {
        let mut stream = probe_video_stream();
        stream.side_data_list.push(ProbeSideData {
            rotation: Some(-90),
            side_data_type: Some("Display Matrix".to_owned()),
        });

        assert_eq!(display_dimensions(&stream), (1080, 1920));
    }

    fn probe_video_stream() -> ProbeStream {
        ProbeStream {
            index: 0,
            codec_type: Some("video".to_owned()),
            codec_name: Some("h264".to_owned()),
            width: Some(1920),
            height: Some(1080),
            avg_frame_rate: None,
            pix_fmt: None,
            bits_per_raw_sample: None,
            color_range: None,
            color_space: None,
            color_transfer: None,
            color_primaries: None,
            channels: None,
            sample_rate: None,
            bit_rate: None,
            tags: HashMap::new(),
            disposition: ProbeDisposition::default(),
            side_data_list: Vec::new(),
        }
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
              "pix_fmt": "yuv420p10le",
              "bits_per_raw_sample": "10",
              "color_range": "tv",
              "color_space": "bt2020nc",
              "color_transfer": "smpte2084",
              "color_primaries": "bt2020",
              "side_data_list": [
                { "side_data_type": "Mastering display metadata" }
              ]
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
        let video = media.video.unwrap();
        assert_eq!(video.pixel_format.as_deref(), Some("yuv420p10le"));
        assert_eq!(video.bit_depth, Some(10));
        assert_eq!(video.color_range.as_deref(), Some("tv"));
        assert_eq!(video.color_space.as_deref(), Some("bt2020nc"));
        assert_eq!(video.color_transfer.as_deref(), Some("smpte2084"));
        assert_eq!(video.color_primaries.as_deref(), Some("bt2020"));
        assert_eq!(video.hdr_format, Some(super::HdrFormat::Hdr10));
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
