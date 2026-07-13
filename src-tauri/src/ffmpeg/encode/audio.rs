use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::{AudioMode, AudioStream, OutputContainer},
};

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

pub(super) fn audio_arguments(
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

#[cfg(test)]
mod tests {
    use super::{audio_arguments, audio_bitrate_cap};
    use crate::ffmpeg::{AudioMode, AudioStream, OutputContainer};

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
}
