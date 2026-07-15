use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::{
        EncodeRequest, EncodingSpeed, OutputContainer, OutputFrameRate, OutputResolution,
        VideoCodec, VideoStream,
    },
};

#[cfg(target_os = "macos")]
fn hardware_encoder(codec: VideoCodec) -> ApiResult<&'static str> {
    match codec {
        VideoCodec::H264 => Ok("h264_videotoolbox"),
        VideoCodec::H265 => Ok("hevc_videotoolbox"),
        _ => Err(ApiError::invalid_input(
            "Fast encoding is available for H.264 and H.265 only.",
        )),
    }
}

#[cfg(not(target_os = "macos"))]
fn hardware_encoder(_codec: VideoCodec) -> ApiResult<&'static str> {
    Err(ApiError::new(
        "unsupported_platform",
        "Fast hardware encoding is not supported on this platform.",
    ))
}

pub(super) fn video_arguments(
    request: &EncodeRequest,
    source: Option<&VideoStream>,
) -> ApiResult<Vec<String>> {
    let container = request.container;
    let codec = request.video_codec;
    let speed = request.encoding_speed;
    let quality = request.quality;
    let resolution = request.output_resolution;
    let frame_rate = request.output_frame_rate;
    let quality_tuning = request.quality_tuning;
    let source_codec = source.map(|video| video.codec.as_str());
    let source_dimensions = source.map(|video| (video.width, video.height));
    let source_frame_rate = source.and_then(|video| video.frame_rate);
    if codec == VideoCodec::Av1 && container != OutputContainer::Mkv {
        return Err(ApiError::invalid_input(
            "AV1 encoding is available with MKV output only.",
        ));
    }
    if !(-2..=2).contains(&quality_tuning) {
        return Err(ApiError::invalid_input(
            "Video quality fine tuning must be between -2 and 2.",
        ));
    }
    if codec == VideoCodec::Copy && quality_tuning != 0 {
        return Err(ApiError::invalid_input(
            "Original video cannot apply quality fine tuning.",
        ));
    }
    if codec == VideoCodec::Copy
        && (resolution != OutputResolution::Source || frame_rate != OutputFrameRate::Source)
    {
        return Err(ApiError::invalid_input(
            "Original video cannot be resized or change frame rate. Choose a video codec or original video settings.",
        ));
    }
    if resolution != OutputResolution::Source && source_dimensions.is_none() {
        return Err(ApiError::invalid_input(
            "The selected input has no video stream to resize.",
        ));
    }

    let adjusted_crf = quality
        .crf(codec)
        .map(|value| (i16::from(value) - i16::from(quality_tuning)).clamp(0, 63));
    let adjusted_hardware_quality =
        (i16::from(quality.videotoolbox_quality()) + i16::from(quality_tuning) * 5).clamp(0, 100);
    let mut arguments = match (codec, speed) {
        (VideoCodec::Copy, _) => {
            let source_codec = source_codec.ok_or_else(|| {
                ApiError::invalid_input("The selected input has no video stream to copy.")
            })?;
            if container == OutputContainer::Mp4
                && !matches!(
                    source_codec.to_ascii_lowercase().as_str(),
                    "h264" | "hevc" | "av1" | "mpeg4"
                )
            {
                return Err(ApiError::invalid_input(
                    "Original video cannot be copied to MP4. Choose a video codec or MKV.",
                ));
            }
            vec!["-c:v".to_owned(), "copy".to_owned()]
        }
        (VideoCodec::Av1, EncodingSpeed::Fast) => {
            return Err(ApiError::invalid_input(
                "Fast encoding is available for H.264 and H.265 only.",
            ));
        }
        (codec, EncodingSpeed::Fast) => vec![
            "-c:v".to_owned(),
            hardware_encoder(codec)?.to_owned(),
            "-q:v".to_owned(),
            adjusted_hardware_quality.to_string(),
            "-prio_speed".to_owned(),
            "1".to_owned(),
        ],
        (VideoCodec::H264, EncodingSpeed::Efficient) => vec![
            "-c:v".to_owned(),
            "libx264".to_owned(),
            "-preset".to_owned(),
            "medium".to_owned(),
            "-crf".to_owned(),
            adjusted_crf.expect("H.264 has a CRF value").to_string(),
        ],
        (VideoCodec::H265, EncodingSpeed::Efficient) => vec![
            "-c:v".to_owned(),
            "libx265".to_owned(),
            "-preset".to_owned(),
            "medium".to_owned(),
            "-crf".to_owned(),
            adjusted_crf.expect("H.265 has a CRF value").to_string(),
        ],
        (VideoCodec::Av1, EncodingSpeed::Efficient) => vec![
            "-c:v".to_owned(),
            "libsvtav1".to_owned(),
            "-preset".to_owned(),
            "8".to_owned(),
            "-crf".to_owned(),
            adjusted_crf.expect("AV1 has a CRF value").to_string(),
        ],
    };

    if container == OutputContainer::Mp4 {
        arguments.extend(["-movflags".to_owned(), "+faststart".to_owned()]);
        if codec == VideoCodec::H265
            || (codec == VideoCodec::Copy
                && source_codec.is_some_and(|value| value.eq_ignore_ascii_case("hevc")))
        {
            arguments.extend(["-tag:v".to_owned(), "hvc1".to_owned()]);
        }
    }

    let mut filters = scale_filter(resolution, source_dimensions)
        .into_iter()
        .collect::<Vec<_>>();
    if let Some(filter) = frame_rate_filter(frame_rate, source_frame_rate)? {
        filters.push(filter);
    }
    if !filters.is_empty() {
        arguments.extend(["-vf".to_owned(), filters.join(",")]);
    }

    Ok(arguments)
}

fn frame_rate_filter(
    frame_rate: OutputFrameRate,
    source_frame_rate: Option<f64>,
) -> ApiResult<Option<String>> {
    let Some(target) = frame_rate.value() else {
        return Ok(None);
    };
    let source = source_frame_rate.ok_or_else(|| {
        ApiError::invalid_input("The source frame rate is unavailable. Choose original frame rate.")
    })?;
    if f64::from(target) >= source - 0.01 {
        return Ok(None);
    }
    Ok(Some(format!("fps={target}")))
}

fn scale_filter(
    resolution: OutputResolution,
    source_dimensions: Option<(u32, u32)>,
) -> Option<String> {
    let (landscape_width, landscape_height) = resolution.landscape_bounds()?;
    let (source_width, source_height) = source_dimensions?;
    let (maximum_width, maximum_height) = if source_width >= source_height {
        (landscape_width, landscape_height)
    } else {
        (landscape_height, landscape_width)
    };
    if source_width <= maximum_width && source_height <= maximum_height {
        return None;
    }

    Some(format!(
        "scale={maximum_width}:{maximum_height}:force_original_aspect_ratio=decrease:force_divisible_by=2"
    ))
}

#[cfg(test)]
mod tests {
    use super::video_arguments as build_video_arguments;
    use crate::{
        error::ApiResult,
        ffmpeg::{
            AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodeRequest, EncodingSpeed,
            OutputContainer, OutputFrameRate, OutputResolution, QualityLevel, VideoCodec,
            VideoStream,
        },
    };

    fn request(
        container: OutputContainer,
        codec: VideoCodec,
        speed: EncodingSpeed,
        quality: QualityLevel,
    ) -> EncodeRequest {
        EncodeRequest {
            input_path: "/input.mov".to_owned(),
            output_path: "/output.mp4".to_owned(),
            quality,
            container,
            video_codec: codec,
            encoding_speed: speed,
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
        }
    }

    fn source(codec: &str, width: u32, height: u32, frame_rate: f64) -> VideoStream {
        VideoStream {
            codec: codec.to_owned(),
            width,
            height,
            frame_rate: Some(frame_rate),
            pixel_format: None,
        }
    }

    fn original_arguments(
        container: OutputContainer,
        codec: VideoCodec,
        speed: EncodingSpeed,
        quality: QualityLevel,
        source_codec: Option<&str>,
    ) -> ApiResult<Vec<String>> {
        let request = request(container, codec, speed, quality);
        let source = source(source_codec.unwrap_or("h264"), 1920, 1080, 30.0);
        build_video_arguments(&request, Some(&source))
    }

    #[test]
    fn quality_levels_map_to_stable_crf_values() {
        assert_eq!(
            QualityLevel::MaximumCompression.crf(VideoCodec::H264),
            Some(30)
        );
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::H264), Some(22));
        assert_eq!(QualityLevel::NearSource.crf(VideoCodec::H264), Some(17));
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::H265), Some(26));
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::Av1), Some(33));
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::Copy), None);
    }

    #[test]
    fn mp4_h265_uses_the_apple_compatible_codec_tag() {
        let arguments = original_arguments(
            OutputContainer::Mp4,
            VideoCodec::H265,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .unwrap();

        assert!(arguments.windows(2).any(|pair| pair == ["-tag:v", "hvc1"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-movflags", "+faststart"]));
    }

    #[test]
    fn mkv_does_not_receive_mp4_specific_arguments() {
        let arguments = original_arguments(
            OutputContainer::Mkv,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .unwrap();

        assert!(!arguments.iter().any(|argument| argument == "-movflags"));
        assert!(!arguments.iter().any(|argument| argument == "-tag:v"));
    }

    #[test]
    fn av1_uses_svt_with_a_stable_preset() {
        let arguments = original_arguments(
            OutputContainer::Mkv,
            VideoCodec::Av1,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .unwrap();

        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-c:v", "libsvtav1"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-preset", "8"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-crf", "33"]));
    }

    #[test]
    fn rejects_av1_in_mp4_and_fast_av1() {
        assert!(original_arguments(
            OutputContainer::Mp4,
            VideoCodec::Av1,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .is_err());
        assert!(original_arguments(
            OutputContainer::Mkv,
            VideoCodec::Av1,
            EncodingSpeed::Fast,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .is_err());
    }

    #[test]
    fn validates_video_copy_for_the_output_container() {
        assert!(original_arguments(
            OutputContainer::Mp4,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("vp9"),
        )
        .is_err());
        assert!(original_arguments(
            OutputContainer::Mkv,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("vp9"),
        )
        .is_ok());
    }

    #[test]
    fn scales_landscape_and_portrait_video_without_changing_aspect_ratio() {
        let mut request = request(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
        );
        request.output_resolution = OutputResolution::P1080;
        let landscape_source = source("h264", 3840, 1600, 60.0);
        let landscape = build_video_arguments(&request, Some(&landscape_source)).unwrap();
        assert!(landscape.windows(2).any(|pair| {
            pair == [
                "-vf",
                "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",
            ]
        }));

        let portrait_source = source("h264", 2160, 3840, 60.0);
        let portrait = build_video_arguments(&request, Some(&portrait_source)).unwrap();
        assert!(portrait.windows(2).any(|pair| {
            pair == [
                "-vf",
                "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2",
            ]
        }));
    }

    #[test]
    fn resolution_caps_never_upscale_and_require_reencoding() {
        let mut request = request(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
        );
        request.output_resolution = OutputResolution::P1080;
        let small_source = source("h264", 1280, 720, 30.0);
        let arguments = build_video_arguments(&request, Some(&small_source)).unwrap();
        assert!(!arguments.iter().any(|argument| argument == "-vf"));

        request.container = OutputContainer::Mkv;
        request.video_codec = VideoCodec::Copy;
        request.output_resolution = OutputResolution::P720;
        let large_source = source("h264", 1920, 1080, 30.0);
        assert!(build_video_arguments(&request, Some(&large_source)).is_err());
    }

    #[test]
    fn combines_lower_frame_rate_with_scaling_and_fine_tunes_quality() {
        let mut request = request(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
        );
        request.output_resolution = OutputResolution::P1080;
        request.output_frame_rate = OutputFrameRate::Fps30;
        request.quality_tuning = 2;
        let source = source("h264", 3840, 2160, 60.0);
        let arguments = build_video_arguments(&request, Some(&source)).unwrap();

        assert!(arguments.windows(2).any(|pair| pair == ["-crf", "20"]));
        assert!(arguments.windows(2).any(|pair| {
            pair == [
                "-vf",
                "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
            ]
        }));
    }

    #[test]
    fn frame_rate_caps_never_create_frames() {
        let mut request = request(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
        );
        request.output_frame_rate = OutputFrameRate::Fps60;
        let source = source("h264", 1920, 1080, 30.0);

        let arguments = build_video_arguments(&request, Some(&source)).unwrap();

        assert!(!arguments.iter().any(|argument| argument == "-vf"));
    }
}
