use super::{
    validate_input, validate_output, AudioMode, AudioStream, EncodeRequest, EncodingSpeed,
    MediaInfo, OutputContainer, QualityLevel, VideoCodec,
};
use crate::{
    error::{ApiError, ApiResult},
    jobs::PendingJob,
};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

const GLOBAL_ARGUMENTS: [&str; 4] = ["-hide_banner", "-nostdin", "-y", "-i"];

fn audio_bitrate_cap(stream: &AudioStream) -> u64 {
    let default_cap = match stream.channels.unwrap_or(2) {
        0 | 1 => 96_000,
        2 => 160_000,
        _ => 256_000,
    };

    stream
        .bit_rate
        .filter(|bit_rate| *bit_rate > 0)
        .unwrap_or(default_cap)
        .min(default_cap)
}

fn converted_audio_arguments(
    streams: &[AudioStream],
    target_codec: &str,
    encoder: &str,
) -> Vec<String> {
    let mut arguments = Vec::new();
    for (index, stream) in streams.iter().enumerate() {
        let codec_option = format!("-c:a:{index}");
        if stream.codec.eq_ignore_ascii_case(target_codec) {
            arguments.extend([codec_option, "copy".to_owned()]);
        } else {
            arguments.extend([codec_option, encoder.to_owned()]);
            arguments.extend([
                format!("-b:a:{index}"),
                audio_bitrate_cap(stream).to_string(),
            ]);
        }
    }
    arguments
}

fn audio_arguments(
    streams: &[AudioStream],
    container: OutputContainer,
    mode: AudioMode,
) -> ApiResult<Vec<String>> {
    match mode {
        AudioMode::None => Ok(vec!["-an".to_owned()]),
        AudioMode::Auto if container == OutputContainer::Mkv => {
            Ok(vec!["-c:a".to_owned(), "copy".to_owned()])
        }
        AudioMode::Auto | AudioMode::Aac => Ok(converted_audio_arguments(streams, "aac", "aac")),
        AudioMode::Copy => {
            if container == OutputContainer::Mp4
                && streams
                    .iter()
                    .any(|stream| !stream.codec.eq_ignore_ascii_case("aac"))
            {
                return Err(ApiError::invalid_input(
                    "Original audio cannot be copied to MP4. Choose Auto, AAC, or MKV.",
                ));
            }
            Ok(vec!["-c:a".to_owned(), "copy".to_owned()])
        }
        AudioMode::Opus => {
            if container != OutputContainer::Mkv {
                return Err(ApiError::invalid_input(
                    "Opus audio is available with MKV output only.",
                ));
            }
            Ok(converted_audio_arguments(streams, "opus", "libopus"))
        }
    }
}

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

fn video_arguments(
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

pub(super) fn validate_settings(request: &EncodeRequest, media: &MediaInfo) -> ApiResult<()> {
    video_arguments(
        request.container,
        request.video_codec,
        request.encoding_speed,
        request.quality,
        media.video.as_ref().map(|video| video.codec.as_str()),
    )?;
    audio_arguments(&media.audio, request.container, request.audio_mode)?;
    Ok(())
}

pub(super) fn build_command(
    app: &AppHandle,
    job: &PendingJob,
) -> ApiResult<tauri_plugin_shell::process::Command> {
    validate_settings(&job.request, &job.media)?;
    let input = validate_input(&job.request.input_path)?;
    let output = validate_output(&job.request.output_path, &input, job.request.container)?;
    let mut command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?
        .args(GLOBAL_ARGUMENTS)
        .arg(input.as_os_str())
        .args([
            "-map",
            "0:v:0?",
            "-map",
            "0:a?",
            "-map_metadata",
            "0",
            "-map_chapters",
            "0",
        ])
        .args(video_arguments(
            job.request.container,
            job.request.video_codec,
            job.request.encoding_speed,
            job.request.quality,
            job.media.video.as_ref().map(|video| video.codec.as_str()),
        )?);

    if job.request.container == OutputContainer::Mkv {
        command = command.args(["-map", "0:s?", "-c:s", "copy"]);
    }

    Ok(command
        .args(audio_arguments(
            &job.media.audio,
            job.request.container,
            job.request.audio_mode,
        )?)
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(output.as_os_str())
        .env("AV_LOG_FORCE_NOCOLOR", "1"))
}

#[cfg(test)]
mod tests {
    use super::{audio_arguments, audio_bitrate_cap, video_arguments, GLOBAL_ARGUMENTS};
    use crate::ffmpeg::{
        AudioMode, AudioStream, EncodingSpeed, OutputContainer, QualityLevel, VideoCodec,
    };

    fn audio(codec: &str, channels: u32, bit_rate: Option<u64>) -> AudioStream {
        AudioStream {
            codec: codec.to_owned(),
            channels: Some(channels),
            sample_rate: Some(48_000),
            bit_rate,
            language: None,
        }
    }

    #[test]
    fn never_raises_a_known_audio_bitrate() {
        assert_eq!(audio_bitrate_cap(&audio("opus", 2, Some(96_000))), 96_000);
        assert_eq!(audio_bitrate_cap(&audio("opus", 2, Some(256_000))), 160_000);
    }

    #[test]
    fn uses_channel_aware_caps_when_bitrate_is_unknown() {
        assert_eq!(audio_bitrate_cap(&audio("flac", 1, None)), 96_000);
        assert_eq!(audio_bitrate_cap(&audio("flac", 2, None)), 160_000);
        assert_eq!(audio_bitrate_cap(&audio("flac", 6, None)), 256_000);
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

    #[test]
    fn audio_modes_copy_or_convert_each_track_explicitly() {
        let streams = vec![
            audio("aac", 2, Some(128_000)),
            audio("flac", 2, Some(900_000)),
        ];
        let automatic = audio_arguments(&streams, OutputContainer::Mp4, AudioMode::Auto).unwrap();
        assert!(automatic.windows(2).any(|pair| pair == ["-c:a:0", "copy"]));
        assert!(automatic.windows(2).any(|pair| pair == ["-c:a:1", "aac"]));

        let opus = audio_arguments(&streams, OutputContainer::Mkv, AudioMode::Opus).unwrap();
        assert!(opus.windows(2).any(|pair| pair == ["-c:a:0", "libopus"]));
        assert!(opus.windows(2).any(|pair| pair == ["-c:a:1", "libopus"]));
    }

    #[test]
    fn rejects_incompatible_audio_modes() {
        let streams = vec![audio("flac", 2, Some(900_000))];
        assert!(audio_arguments(&streams, OutputContainer::Mp4, AudioMode::Copy).is_err());
        assert!(audio_arguments(&streams, OutputContainer::Mp4, AudioMode::Opus).is_err());
        assert_eq!(
            audio_arguments(&streams, OutputContainer::Mkv, AudioMode::None).unwrap(),
            ["-an"]
        );
    }

    #[test]
    fn ffmpeg_does_not_read_from_the_controlling_terminal() {
        assert!(GLOBAL_ARGUMENTS.contains(&"-nostdin"));
    }
}
