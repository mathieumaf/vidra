use crate::diagnostics::DiagnosticReport;
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
    pub dolby_vision: Option<DolbyVisionInfo>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DolbyVisionInfo {
    pub profile: Option<u8>,
    pub base_layer_compatibility_id: Option<u8>,
    pub has_enhancement_layer: bool,
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentTrim {
    pub start_seconds: f64,
    pub end_seconds: f64,
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
    #[serde(default)]
    pub replace_existing: bool,
    #[serde(default)]
    pub allow_insufficient_disk_space: bool,
    #[serde(default)]
    pub trim: Option<SegmentTrim>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeProgress {
    pub job_id: String,
    pub percent: f64,
    pub indeterminate: bool,
    pub elapsed_seconds: f64,
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
    pub diagnostic: Option<DiagnosticReport>,
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

#[cfg(test)]
mod tests {
    use super::{
        AudioBitrate, AudioChannels, AudioMode, AudioStream, AudioTrackMode, DolbyVisionInfo,
        EncodeFinished, EncodePauseChanged, EncodeProgress, EncodeRequest, EncodeStarted,
        EncodingSpeed, FfmpegStatus, HdrFormat, MediaInfo, OutputContainer, OutputFrameRate,
        OutputResolution, QualityLevel, QueuedEncode, SegmentTrim, SubtitleStream, VideoCodec,
        VideoStream,
    };
    use crate::diagnostics::DiagnosticReport;

    #[test]
    fn encode_requests_use_the_frontend_field_names() {
        let request: EncodeRequest = serde_json::from_value(serde_json::json!({
            "inputPath": "/videos/holiday.mov",
            "outputPath": "/videos/holiday-vidra.mp4",
            "quality": "high-quality",
            "container": "mp4",
            "videoCodec": "h265",
            "encodingSpeed": "efficient",
            "audioMode": "aac",
            "outputResolution": "1080p",
            "outputFrameRate": "30",
            "qualityTuning": -1,
            "audioBitrate": "192",
            "audioChannels": "stereo",
            "audioTrackMode": "first",
            "audioStreamIndexes": [1, 3],
            "subtitleStreamIndexes": [4],
            "preserveSubtitles": false,
            "preserveMetadata": true,
            "preserveChapters": false,
            "replaceExisting": true,
            "allowInsufficientDiskSpace": true
        }))
        .unwrap();

        assert_eq!(request.input_path, "/videos/holiday.mov");
        assert_eq!(request.output_path, "/videos/holiday-vidra.mp4");
        assert_eq!(request.quality, QualityLevel::HighQuality);
        assert_eq!(request.container, OutputContainer::Mp4);
        assert_eq!(request.video_codec, VideoCodec::H265);
        assert_eq!(request.encoding_speed, EncodingSpeed::Efficient);
        assert_eq!(request.audio_mode, AudioMode::Aac);
        assert_eq!(request.output_resolution, OutputResolution::P1080);
        assert_eq!(request.output_frame_rate, OutputFrameRate::Fps30);
        assert_eq!(request.quality_tuning, -1);
        assert_eq!(request.audio_bitrate, AudioBitrate::Kbps192);
        assert_eq!(request.audio_channels, AudioChannels::Stereo);
        assert_eq!(request.audio_track_mode, AudioTrackMode::First);
        assert_eq!(request.audio_stream_indexes, vec![1, 3]);
        assert_eq!(request.subtitle_stream_indexes, vec![4]);
        assert!(!request.preserve_subtitles);
        assert!(request.preserve_metadata);
        assert!(!request.preserve_chapters);
        assert!(request.replace_existing);
        assert!(request.allow_insufficient_disk_space);
        assert!(request.trim.is_none());
    }

    #[test]
    fn optional_encode_request_flags_default_to_false() {
        let request: EncodeRequest = serde_json::from_value(serde_json::json!({
            "inputPath": "/videos/holiday.mkv",
            "outputPath": "/videos/holiday-vidra.mkv",
            "quality": "near-source",
            "container": "mkv",
            "videoCodec": "av1",
            "encodingSpeed": "fast",
            "audioMode": "opus",
            "outputResolution": "source",
            "outputFrameRate": "source",
            "qualityTuning": 0,
            "audioBitrate": "auto",
            "audioChannels": "source",
            "audioTrackMode": "all",
            "audioStreamIndexes": [],
            "subtitleStreamIndexes": [],
            "preserveSubtitles": true,
            "preserveMetadata": true,
            "preserveChapters": true
        }))
        .unwrap();

        assert_eq!(request.container, OutputContainer::Mkv);
        assert_eq!(request.video_codec, VideoCodec::Av1);
        assert_eq!(request.audio_mode, AudioMode::Opus);
        assert_eq!(request.quality, QualityLevel::NearSource);
        assert!(!request.replace_existing);
        assert!(!request.allow_insufficient_disk_space);
        assert!(request.trim.is_none());
    }

    #[test]
    fn segment_bounds_use_the_frontend_field_names() {
        let request: EncodeRequest = serde_json::from_value(serde_json::json!({
            "inputPath": "/videos/holiday.mov",
            "outputPath": "/videos/holiday-vidra.mp4",
            "quality": "balanced",
            "container": "mp4",
            "videoCodec": "h264",
            "encodingSpeed": "efficient",
            "audioMode": "auto",
            "outputResolution": "source",
            "outputFrameRate": "source",
            "qualityTuning": 0,
            "audioBitrate": "auto",
            "audioChannels": "source",
            "audioTrackMode": "all",
            "audioStreamIndexes": [],
            "subtitleStreamIndexes": [],
            "preserveSubtitles": true,
            "preserveMetadata": true,
            "preserveChapters": true,
            "trim": { "startSeconds": 1.5, "endSeconds": 4.0 }
        }))
        .unwrap();

        assert_eq!(
            request.trim,
            Some(SegmentTrim {
                start_seconds: 1.5,
                end_seconds: 4.0,
            })
        );
        assert_eq!(
            serde_json::to_value(request.trim).unwrap(),
            serde_json::json!({ "startSeconds": 1.5, "endSeconds": 4.0 })
        );
    }

    #[test]
    fn quality_container_codec_and_hdr_names_match_the_frontend() {
        let wire = serde_json::json!({
            "qualities": [
                QualityLevel::MaximumCompression,
                QualityLevel::SmallerFile,
                QualityLevel::Balanced,
                QualityLevel::HighQuality,
                QualityLevel::NearSource
            ],
            "containers": [OutputContainer::Mp4, OutputContainer::Mkv],
            "codecs": [VideoCodec::Copy, VideoCodec::H264, VideoCodec::H265, VideoCodec::Av1],
            "speeds": [EncodingSpeed::Efficient, EncodingSpeed::Fast],
            "audioModes": [
                AudioMode::Auto,
                AudioMode::Copy,
                AudioMode::Aac,
                AudioMode::Opus,
                AudioMode::None
            ],
            "resolutions": [
                OutputResolution::Source,
                OutputResolution::P2160,
                OutputResolution::P1440,
                OutputResolution::P1080,
                OutputResolution::P720,
                OutputResolution::P480,
                OutputResolution::P360
            ],
            "frameRates": [
                OutputFrameRate::Source,
                OutputFrameRate::Fps24,
                OutputFrameRate::Fps25,
                OutputFrameRate::Fps30,
                OutputFrameRate::Fps50,
                OutputFrameRate::Fps60
            ],
            "bitrates": [
                AudioBitrate::Auto,
                AudioBitrate::Kbps96,
                AudioBitrate::Kbps128,
                AudioBitrate::Kbps160,
                AudioBitrate::Kbps192,
                AudioBitrate::Kbps256
            ],
            "channels": [AudioChannels::Source, AudioChannels::Stereo, AudioChannels::Mono],
            "tracks": [AudioTrackMode::All, AudioTrackMode::First],
            "hdr": [
                HdrFormat::DolbyVision,
                HdrFormat::Hdr10Plus,
                HdrFormat::Hdr10,
                HdrFormat::Hlg,
                HdrFormat::Pq,
                HdrFormat::Hdr
            ]
        });

        assert_eq!(
            wire,
            serde_json::json!({
                "qualities": [
                    "maximum-compression",
                    "smaller-file",
                    "balanced",
                    "high-quality",
                    "near-source"
                ],
                "containers": ["mp4", "mkv"],
                "codecs": ["copy", "h264", "h265", "av1"],
                "speeds": ["efficient", "fast"],
                "audioModes": ["auto", "copy", "aac", "opus", "none"],
                "resolutions": ["source", "2160p", "1440p", "1080p", "720p", "480p", "360p"],
                "frameRates": ["source", "24", "25", "30", "50", "60"],
                "bitrates": ["auto", "96", "128", "160", "192", "256"],
                "channels": ["source", "stereo", "mono"],
                "tracks": ["all", "first"],
                "hdr": ["dolby-vision", "hdr10-plus", "hdr10", "hlg", "pq", "hdr"]
            })
        );
    }

    #[test]
    fn inspected_media_and_queue_events_serialize_for_the_frontend() {
        let media = MediaInfo {
            path: "/videos/holiday.mkv".to_owned(),
            name: "holiday.mkv".to_owned(),
            duration_seconds: 12.5,
            size_bytes: 2048,
            format_name: "matroska,webm".to_owned(),
            format_long_name: Some("Matroska / WebM".to_owned()),
            video: Some(VideoStream {
                codec: "hevc".to_owned(),
                width: 3840,
                height: 2160,
                frame_rate: Some(24_000.0 / 1_001.0),
                pixel_format: Some("yuv420p10le".to_owned()),
                bit_depth: Some(10),
                color_range: Some("tv".to_owned()),
                color_space: Some("bt2020nc".to_owned()),
                color_transfer: Some("smpte2084".to_owned()),
                color_primaries: Some("bt2020".to_owned()),
                hdr_format: Some(HdrFormat::DolbyVision),
                dolby_vision: Some(DolbyVisionInfo {
                    profile: Some(8),
                    base_layer_compatibility_id: Some(1),
                    has_enhancement_layer: false,
                }),
            }),
            audio: vec![AudioStream {
                index: 1,
                codec: "aac".to_owned(),
                channels: Some(2),
                sample_rate: Some(48_000),
                bit_rate: Some(160_000),
                language: Some("eng".to_owned()),
                title: Some("Stereo".to_owned()),
            }],
            subtitles: vec![SubtitleStream {
                index: 2,
                codec: "subrip".to_owned(),
                language: Some("fra".to_owned()),
                title: None,
                is_default: true,
                is_forced: false,
            }],
            chapter_count: 3,
            has_metadata: true,
        };
        let value = serde_json::to_value(&media).unwrap();
        assert_eq!(value["path"], "/videos/holiday.mkv");
        assert_eq!(value["durationSeconds"], 12.5);
        assert_eq!(value["sizeBytes"], 2048);
        assert_eq!(value["formatName"], "matroska,webm");
        assert_eq!(value["formatLongName"], "Matroska / WebM");
        assert_eq!(value["chapterCount"], 3);
        assert_eq!(value["hasMetadata"], true);
        assert_eq!(value["video"]["frameRate"], 24_000.0 / 1_001.0);
        assert_eq!(value["video"]["pixelFormat"], "yuv420p10le");
        assert_eq!(value["video"]["bitDepth"], 10);
        assert_eq!(value["video"]["colorRange"], "tv");
        assert_eq!(value["video"]["colorSpace"], "bt2020nc");
        assert_eq!(value["video"]["colorTransfer"], "smpte2084");
        assert_eq!(value["video"]["colorPrimaries"], "bt2020");
        assert_eq!(value["video"]["hdrFormat"], "dolby-vision");
        assert_eq!(value["video"]["dolbyVision"]["profile"], 8);
        assert_eq!(value["video"]["dolbyVision"]["baseLayerCompatibilityId"], 1);
        assert_eq!(value["video"]["dolbyVision"]["hasEnhancementLayer"], false);
        assert_eq!(value["audio"][0]["sampleRate"], 48_000);
        assert_eq!(value["audio"][0]["bitRate"], 160_000);
        assert_eq!(value["subtitles"][0]["isDefault"], true);
        assert_eq!(value["subtitles"][0]["isForced"], false);

        let status = FfmpegStatus {
            ready: false,
            ffmpeg_version: None,
            ffprobe_version: None,
            error: Some("ffprobe missing".to_owned()),
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "ready": false,
                "ffmpegVersion": null,
                "ffprobeVersion": null,
                "error": "ffprobe missing"
            })
        );

        let progress = EncodeProgress {
            job_id: "job-1".to_owned(),
            percent: 40.0,
            indeterminate: false,
            elapsed_seconds: 3.0,
            out_time_seconds: 2.5,
            speed: Some("1.2x".to_owned()),
            eta_seconds: Some(4.0),
            frame: Some(60),
        };
        assert_eq!(
            serde_json::to_value(progress).unwrap(),
            serde_json::json!({
                "jobId": "job-1",
                "percent": 40.0,
                "indeterminate": false,
                "elapsedSeconds": 3.0,
                "outTimeSeconds": 2.5,
                "speed": "1.2x",
                "etaSeconds": 4.0,
                "frame": 60
            })
        );

        let finished = EncodeFinished {
            job_id: "job-1".to_owned(),
            status: "failed".to_owned(),
            output_path: "/videos/holiday-vidra.mp4".to_owned(),
            error: Some("FFmpeg could not complete this conversion.".to_owned()),
            diagnostic: Some(DiagnosticReport {
                code: "ffmpeg_failure".to_owned(),
                summary: "FFmpeg could not complete this conversion.".to_owned(),
                report: "Vidra diagnostic report".to_owned(),
            }),
        };
        let finished = serde_json::to_value(finished).unwrap();
        assert_eq!(finished["jobId"], "job-1");
        assert_eq!(finished["outputPath"], "/videos/holiday-vidra.mp4");
        assert_eq!(finished["diagnostic"]["code"], "ffmpeg_failure");
        assert_eq!(finished["diagnostic"]["summary"], finished["error"]);

        assert_eq!(
            serde_json::to_value(QueuedEncode {
                job_id: "job-2".to_owned(),
                input_path: "/videos/holiday.mkv".to_owned(),
                output_path: "/videos/holiday-vidra.mkv".to_owned(),
            })
            .unwrap(),
            serde_json::json!({
                "jobId": "job-2",
                "inputPath": "/videos/holiday.mkv",
                "outputPath": "/videos/holiday-vidra.mkv"
            })
        );
        assert_eq!(
            serde_json::to_value(EncodeStarted {
                job_id: "job-2".to_owned(),
            })
            .unwrap(),
            serde_json::json!({ "jobId": "job-2" })
        );
        assert_eq!(
            serde_json::to_value(EncodePauseChanged {
                job_id: "job-2".to_owned(),
                paused: true,
            })
            .unwrap(),
            serde_json::json!({ "jobId": "job-2", "paused": true })
        );
    }
}
