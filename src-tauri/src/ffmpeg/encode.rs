use super::{
    validate_input, validate_output, AudioStream, OutputContainer, QualityLevel, VideoCodec,
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

fn add_audio_arguments(
    mut command: tauri_plugin_shell::process::Command,
    streams: &[AudioStream],
    container: OutputContainer,
) -> tauri_plugin_shell::process::Command {
    if container == OutputContainer::Mkv {
        return command.args(["-c:a", "copy"]);
    }

    for (index, stream) in streams.iter().enumerate() {
        let codec_option = format!("-c:a:{index}");
        if stream.codec.eq_ignore_ascii_case("aac") {
            command = command.args([codec_option, "copy".to_owned()]);
        } else {
            command = command.args([codec_option, "aac".to_owned()]).args([
                format!("-b:a:{index}"),
                audio_bitrate_cap(stream).to_string(),
            ]);
        }
    }

    command
}

fn video_arguments(
    container: OutputContainer,
    codec: VideoCodec,
    quality: QualityLevel,
) -> Vec<&'static str> {
    let mut arguments = match codec {
        VideoCodec::H264 => vec![
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            quality.crf(codec),
        ],
        VideoCodec::H265 => vec![
            "-c:v",
            "libx265",
            "-preset",
            "medium",
            "-crf",
            quality.crf(codec),
        ],
    };

    if container == OutputContainer::Mp4 {
        arguments.extend(["-movflags", "+faststart"]);
        if codec == VideoCodec::H265 {
            arguments.extend(["-tag:v", "hvc1"]);
        }
    }

    arguments
}

pub(super) fn build_command(
    app: &AppHandle,
    job: &PendingJob,
) -> ApiResult<tauri_plugin_shell::process::Command> {
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
            job.request.quality,
        ));

    if job.request.container == OutputContainer::Mkv {
        command = command.args(["-map", "0:s?", "-c:s", "copy"]);
    }

    Ok(
        add_audio_arguments(command, &job.media.audio, job.request.container)
            .args(["-progress", "pipe:1", "-nostats"])
            .arg(output.as_os_str())
            .env("AV_LOG_FORCE_NOCOLOR", "1"),
    )
}

#[cfg(test)]
mod tests {
    use super::{audio_bitrate_cap, video_arguments, GLOBAL_ARGUMENTS};
    use crate::ffmpeg::{AudioStream, OutputContainer, QualityLevel, VideoCodec};

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
        assert_eq!(QualityLevel::MaximumCompression.crf(VideoCodec::H264), "30");
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::H264), "22");
        assert_eq!(QualityLevel::NearSource.crf(VideoCodec::H264), "17");
        assert_eq!(QualityLevel::Balanced.crf(VideoCodec::H265), "26");
    }

    #[test]
    fn mp4_h265_uses_the_apple_compatible_codec_tag() {
        let arguments = video_arguments(
            OutputContainer::Mp4,
            VideoCodec::H265,
            QualityLevel::Balanced,
        );

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
            QualityLevel::Balanced,
        );

        assert!(!arguments.contains(&"-movflags"));
        assert!(!arguments.contains(&"-tag:v"));
    }

    #[test]
    fn ffmpeg_does_not_read_from_the_controlling_terminal() {
        assert!(GLOBAL_ARGUMENTS.contains(&"-nostdin"));
    }
}
