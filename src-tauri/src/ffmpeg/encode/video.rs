use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::{EncodingSpeed, OutputContainer, OutputResolution, QualityLevel, VideoCodec},
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
    container: OutputContainer,
    codec: VideoCodec,
    speed: EncodingSpeed,
    quality: QualityLevel,
    resolution: OutputResolution,
    source_codec: Option<&str>,
    source_dimensions: Option<(u32, u32)>,
) -> ApiResult<Vec<String>> {
    if codec == VideoCodec::Av1 && container != OutputContainer::Mkv {
        return Err(ApiError::invalid_input(
            "AV1 encoding is available with MKV output only.",
        ));
    }
    if codec == VideoCodec::Copy && resolution != OutputResolution::Source {
        return Err(ApiError::invalid_input(
            "Original video cannot be resized. Choose a video codec or original resolution.",
        ));
    }
    if resolution != OutputResolution::Source && source_dimensions.is_none() {
        return Err(ApiError::invalid_input(
            "The selected input has no video stream to resize.",
        ));
    }

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
            vec!["-c:v", "copy"]
        }
        (VideoCodec::Av1, EncodingSpeed::Fast) => {
            return Err(ApiError::invalid_input(
                "Fast encoding is available for H.264 and H.265 only.",
            ));
        }
        (codec, EncodingSpeed::Fast) => vec![
            "-c:v",
            hardware_encoder(codec)?,
            "-q:v",
            quality.videotoolbox_quality(),
            "-prio_speed",
            "1",
        ],
        (VideoCodec::H264, EncodingSpeed::Efficient) => vec![
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            quality.crf(codec).expect("H.264 has a CRF value"),
        ],
        (VideoCodec::H265, EncodingSpeed::Efficient) => vec![
            "-c:v",
            "libx265",
            "-preset",
            "medium",
            "-crf",
            quality.crf(codec).expect("H.265 has a CRF value"),
        ],
        (VideoCodec::Av1, EncodingSpeed::Efficient) => vec![
            "-c:v",
            "libsvtav1",
            "-preset",
            "8",
            "-crf",
            quality.crf(codec).expect("AV1 has a CRF value"),
        ],
    }
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();

    if container == OutputContainer::Mp4 {
        arguments.extend(["-movflags".to_owned(), "+faststart".to_owned()]);
        if codec == VideoCodec::H265
            || (codec == VideoCodec::Copy
                && source_codec.is_some_and(|value| value.eq_ignore_ascii_case("hevc")))
        {
            arguments.extend(["-tag:v".to_owned(), "hvc1".to_owned()]);
        }
    }

    if let Some(filter) = scale_filter(resolution, source_dimensions) {
        arguments.extend(["-vf".to_owned(), filter]);
    }

    Ok(arguments)
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
    use super::video_arguments;
    use crate::{
        error::ApiResult,
        ffmpeg::{EncodingSpeed, OutputContainer, OutputResolution, QualityLevel, VideoCodec},
    };

    fn original_arguments(
        container: OutputContainer,
        codec: VideoCodec,
        speed: EncodingSpeed,
        quality: QualityLevel,
        source_codec: Option<&str>,
    ) -> ApiResult<Vec<String>> {
        video_arguments(
            container,
            codec,
            speed,
            quality,
            OutputResolution::Source,
            source_codec,
            Some((1920, 1080)),
        )
    }

    #[test]
    fn quality_levels_map_to_stable_crf_values() {
        assert_eq!(
            QualityLevel::MaximumCompression.crf(VideoCodec::H264),
            Some("30")
        );
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::H264), Some("22"));
        assert_eq!(QualityLevel::NearSource.crf(VideoCodec::H264), Some("17"));
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::H265), Some("26"));
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::Av1), Some("33"));
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
        let landscape = video_arguments(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            OutputResolution::P1080,
            Some("h264"),
            Some((3840, 1600)),
        )
        .unwrap();
        assert!(landscape.windows(2).any(|pair| {
            pair == [
                "-vf",
                "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",
            ]
        }));

        let portrait = video_arguments(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            OutputResolution::P1080,
            Some("h264"),
            Some((2160, 3840)),
        )
        .unwrap();
        assert!(portrait.windows(2).any(|pair| {
            pair == [
                "-vf",
                "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2",
            ]
        }));
    }

    #[test]
    fn resolution_caps_never_upscale_and_require_reencoding() {
        let arguments = video_arguments(
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            OutputResolution::P1080,
            Some("h264"),
            Some((1280, 720)),
        )
        .unwrap();
        assert!(!arguments.iter().any(|argument| argument == "-vf"));

        assert!(video_arguments(
            OutputContainer::Mkv,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            OutputResolution::P720,
            Some("h264"),
            Some((1920, 1080)),
        )
        .is_err());
    }
}
