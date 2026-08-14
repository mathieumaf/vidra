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

/// Vidra writes an explicit output pixel format so that the profile of a
/// converted file follows the selected codec instead of FFmpeg's negotiation
/// with the source.
///
/// Chroma is always normalized to 4:2:0, because 4:2:2 and 4:4:4 output lands in
/// professional profiles that consumer hardware decoders reject. H.264 stays at
/// 8 bits on both encoding speeds, since High 10 has almost no hardware decoding
/// support and that defeats the reason to choose H.264. H.265 and AV1 keep a
/// 10-bit source at 10 bits, where Main 10 and AV1 Main 10-bit decode widely and
/// the extra depth avoids banding. Deeper sources are capped at 10 bits, and an
/// unprobed bit depth is treated as 8-bit.
fn output_pixel_format(
    codec: VideoCodec,
    speed: EncodingSpeed,
    source_bit_depth: Option<u8>,
) -> Option<&'static str> {
    if codec == VideoCodec::Copy {
        return None;
    }
    let ten_bit = matches!(codec, VideoCodec::H265 | VideoCodec::Av1)
        && source_bit_depth.is_some_and(|depth| depth > 8);
    Some(match (speed, ten_bit) {
        (_, false) => "yuv420p",
        (EncodingSpeed::Efficient, true) => "yuv420p10le",
        // VideoToolbox encoders take 10-bit frames as semi-planar p010le.
        (EncodingSpeed::Fast, true) => "p010le",
    })
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
    let source_bit_depth = source.and_then(|video| video.bit_depth);
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
        if let Some(tag) = mp4_video_tag(codec, source_codec) {
            arguments.extend(["-tag:v".to_owned(), tag.to_owned()]);
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
    if let Some(pixel_format) = output_pixel_format(codec, speed, source_bit_depth) {
        arguments.extend(["-pix_fmt".to_owned(), pixel_format.to_owned()]);
    }

    Ok(arguments)
}

fn mp4_video_tag(codec: VideoCodec, source_codec: Option<&str>) -> Option<&'static str> {
    let stream_codec = match codec {
        VideoCodec::H264 => return None,
        VideoCodec::H265 => "hevc",
        VideoCodec::Av1 => "av1",
        VideoCodec::Copy => source_codec?,
    };
    match stream_codec.to_ascii_lowercase().as_str() {
        "hevc" => Some("hvc1"),
        "av1" => Some("av01"),
        _ => None,
    }
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
    use super::{output_pixel_format, video_arguments as build_video_arguments};
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
            replace_existing: false,
        }
    }

    fn source(codec: &str, width: u32, height: u32, frame_rate: f64) -> VideoStream {
        VideoStream {
            codec: codec.to_owned(),
            width,
            height,
            frame_rate: Some(frame_rate),
            pixel_format: None,
            bit_depth: None,
            color_range: None,
            color_space: None,
            color_transfer: None,
            color_primaries: None,
            hdr_format: None,
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

    fn source_with_pixel_format(
        codec: &str,
        pixel_format: &str,
        bit_depth: Option<u8>,
    ) -> VideoStream {
        VideoStream {
            pixel_format: Some(pixel_format.to_owned()),
            bit_depth,
            ..source(codec, 3840, 2160, 30.0)
        }
    }

    fn pixel_format_argument(arguments: &[String]) -> Option<&str> {
        arguments
            .windows(2)
            .find(|pair| pair[0] == "-pix_fmt")
            .map(|pair| pair[1].as_str())
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
    fn h264_targets_eight_bit_four_two_zero_from_a_ten_bit_source() {
        let ten_bit_hevc = source_with_pixel_format("hevc", "yuv420p10le", Some(10));
        let request = request(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
        );

        let arguments = build_video_arguments(&request, Some(&ten_bit_hevc)).unwrap();

        assert!(arguments.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
        assert_eq!(pixel_format_argument(&arguments), Some("yuv420p"));
    }

    #[test]
    fn both_encoding_speeds_agree_on_the_h264_pixel_format() {
        for bit_depth in [None, Some(8), Some(10), Some(12)] {
            let efficient =
                output_pixel_format(VideoCodec::H264, EncodingSpeed::Efficient, bit_depth);
            let fast = output_pixel_format(VideoCodec::H264, EncodingSpeed::Fast, bit_depth);

            assert_eq!(efficient, Some("yuv420p"));
            assert_eq!(fast, efficient);
        }
    }

    #[test]
    fn h265_and_av1_preserve_ten_bit_sources() {
        assert_eq!(
            output_pixel_format(VideoCodec::H265, EncodingSpeed::Efficient, Some(10)),
            Some("yuv420p10le")
        );
        assert_eq!(
            output_pixel_format(VideoCodec::Av1, EncodingSpeed::Efficient, Some(10)),
            Some("yuv420p10le")
        );
        assert_eq!(
            output_pixel_format(VideoCodec::H265, EncodingSpeed::Fast, Some(10)),
            Some("p010le")
        );

        let ten_bit_hevc = source_with_pixel_format("hevc", "yuv420p10le", Some(10));
        let mut request = request(
            OutputContainer::Mp4,
            VideoCodec::H265,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
        );
        let h265 = build_video_arguments(&request, Some(&ten_bit_hevc)).unwrap();
        assert_eq!(pixel_format_argument(&h265), Some("yuv420p10le"));

        request.container = OutputContainer::Mkv;
        request.video_codec = VideoCodec::Av1;
        let av1 = build_video_arguments(&request, Some(&ten_bit_hevc)).unwrap();
        assert_eq!(pixel_format_argument(&av1), Some("yuv420p10le"));
    }

    #[test]
    fn sources_deeper_than_ten_bit_are_capped_at_ten_bit() {
        assert_eq!(
            output_pixel_format(VideoCodec::H265, EncodingSpeed::Efficient, Some(12)),
            Some("yuv420p10le")
        );
        assert_eq!(
            output_pixel_format(VideoCodec::Av1, EncodingSpeed::Efficient, Some(16)),
            Some("yuv420p10le")
        );
    }

    #[test]
    fn eight_bit_and_unprobed_sources_stay_eight_bit() {
        for codec in [VideoCodec::H264, VideoCodec::H265, VideoCodec::Av1] {
            for bit_depth in [None, Some(8)] {
                assert_eq!(
                    output_pixel_format(codec, EncodingSpeed::Efficient, bit_depth),
                    Some("yuv420p")
                );
            }
        }
    }

    #[test]
    fn chroma_richer_than_four_two_zero_is_normalized() {
        let prores = source_with_pixel_format("prores", "yuv422p10le", Some(10));
        let mut request = request(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
        );
        let h264 = build_video_arguments(&request, Some(&prores)).unwrap();
        assert_eq!(pixel_format_argument(&h264), Some("yuv420p"));

        request.video_codec = VideoCodec::H265;
        let h265 = build_video_arguments(&request, Some(&prores)).unwrap();
        assert_eq!(pixel_format_argument(&h265), Some("yuv420p10le"));
    }

    #[test]
    fn copying_the_original_video_never_forces_a_pixel_format() {
        assert_eq!(
            output_pixel_format(VideoCodec::Copy, EncodingSpeed::Efficient, Some(10)),
            None
        );

        let arguments = original_arguments(
            OutputContainer::Mkv,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("prores"),
        )
        .unwrap();

        assert!(!arguments.iter().any(|argument| argument == "-pix_fmt"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn fast_hardware_paths_follow_the_same_pixel_format_policy() {
        let ten_bit_hevc = source_with_pixel_format("hevc", "yuv420p10le", Some(10));
        let mut request = request(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Fast,
            QualityLevel::Balanced,
        );
        let h264 = build_video_arguments(&request, Some(&ten_bit_hevc)).unwrap();
        assert!(h264
            .windows(2)
            .any(|pair| pair == ["-c:v", "h264_videotoolbox"]));
        assert_eq!(pixel_format_argument(&h264), Some("yuv420p"));

        request.video_codec = VideoCodec::H265;
        let h265 = build_video_arguments(&request, Some(&ten_bit_hevc)).unwrap();
        assert_eq!(pixel_format_argument(&h265), Some("p010le"));
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
    fn mp4_av1_uses_the_av01_sample_entry_and_faststart() {
        let arguments = original_arguments(
            OutputContainer::Mp4,
            VideoCodec::Av1,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .unwrap();

        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-c:v", "libsvtav1"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-tag:v", "av01"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-movflags", "+faststart"]));
    }

    #[test]
    fn mp4_video_copy_keeps_the_source_sample_entry() {
        let av1 = original_arguments(
            OutputContainer::Mp4,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("av1"),
        )
        .unwrap();
        assert!(av1.windows(2).any(|pair| pair == ["-tag:v", "av01"]));

        let h264 = original_arguments(
            OutputContainer::Mp4,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .unwrap();
        assert!(!h264.iter().any(|argument| argument == "-tag:v"));
    }

    #[test]
    fn rejects_fast_av1_in_every_container() {
        assert!(original_arguments(
            OutputContainer::Mkv,
            VideoCodec::Av1,
            EncodingSpeed::Fast,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .is_err());
        assert!(original_arguments(
            OutputContainer::Mp4,
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
