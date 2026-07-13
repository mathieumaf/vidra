use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::{EncodingSpeed, OutputContainer, QualityLevel, VideoCodec},
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
    source_codec: Option<&str>,
) -> ApiResult<Vec<&'static str>> {
    if codec == VideoCodec::Av1 && container != OutputContainer::Mkv {
        return Err(ApiError::invalid_input(
            "AV1 encoding is available with MKV output only.",
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
    };

    if container == OutputContainer::Mp4 {
        arguments.extend(["-movflags", "+faststart"]);
        if codec == VideoCodec::H265
            || (codec == VideoCodec::Copy
                && source_codec.is_some_and(|value| value.eq_ignore_ascii_case("hevc")))
        {
            arguments.extend(["-tag:v", "hvc1"]);
        }
    }

    Ok(arguments)
}

#[cfg(test)]
mod tests {
    use super::video_arguments;
    use crate::ffmpeg::{EncodingSpeed, OutputContainer, QualityLevel, VideoCodec};

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
        let arguments = video_arguments(
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
        let arguments = video_arguments(
            OutputContainer::Mkv,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .unwrap();

        assert!(!arguments.contains(&"-movflags"));
        assert!(!arguments.contains(&"-tag:v"));
    }

    #[test]
    fn av1_uses_svt_with_a_stable_preset() {
        let arguments = video_arguments(
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
        assert!(video_arguments(
            OutputContainer::Mp4,
            VideoCodec::Av1,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("h264"),
        )
        .is_err());
        assert!(video_arguments(
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
        assert!(video_arguments(
            OutputContainer::Mp4,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("vp9"),
        )
        .is_err());
        assert!(video_arguments(
            OutputContainer::Mkv,
            VideoCodec::Copy,
            EncodingSpeed::Efficient,
            QualityLevel::Balanced,
            Some("vp9"),
        )
        .is_ok());
    }
}
