use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::{AudioBitrate, AudioChannels, AudioMode, AudioStream, OutputContainer},
};

fn audio_bitrate_cap(stream: &AudioStream, bitrate: AudioBitrate, channels: AudioChannels) -> u64 {
    let output_channels = channels
        .maximum()
        .map(|maximum| stream.channels.unwrap_or(maximum).min(maximum))
        .unwrap_or_else(|| stream.channels.unwrap_or(2));
    let default_cap = match output_channels {
        0 | 1 => 96_000,
        2 => 160_000,
        _ => 256_000,
    };

    let requested = bitrate.bits_per_second().unwrap_or(default_cap);
    stream
        .bit_rate
        .filter(|bit_rate| *bit_rate > 0)
        .unwrap_or(requested)
        .min(requested)
}

fn converted_audio_arguments(
    streams: &[AudioStream],
    target_codec: &str,
    encoder: &str,
    bitrate: AudioBitrate,
    channels: AudioChannels,
) -> Vec<String> {
    let mut arguments = Vec::new();
    for (index, stream) in streams.iter().enumerate() {
        let codec_option = format!("-c:a:{index}");
        let changes_bitrate = bitrate.bits_per_second().is_some_and(|maximum| {
            stream
                .bit_rate
                .is_none_or(|source| source == 0 || source > maximum)
        });
        let changes_channels = channels.maximum().is_some_and(|maximum| {
            stream
                .channels
                .is_none_or(|source| source == 0 || source > maximum)
        });
        if stream.codec.eq_ignore_ascii_case(target_codec) && !changes_bitrate && !changes_channels
        {
            arguments.extend([codec_option, "copy".to_owned()]);
        } else {
            arguments.extend([codec_option, encoder.to_owned()]);
            arguments.extend([
                format!("-b:a:{index}"),
                audio_bitrate_cap(stream, bitrate, channels).to_string(),
            ]);
            if let Some(maximum) = channels.maximum() {
                if stream
                    .channels
                    .is_none_or(|source| source == 0 || source > maximum)
                {
                    arguments.extend([format!("-ac:a:{index}"), maximum.to_string()]);
                }
            }
        }
    }
    arguments
}

pub(super) fn audio_arguments(
    streams: &[AudioStream],
    container: OutputContainer,
    mode: AudioMode,
    bitrate: AudioBitrate,
    channels: AudioChannels,
) -> ApiResult<Vec<String>> {
    let modifies_audio = bitrate != AudioBitrate::Auto || channels != AudioChannels::Source;
    match mode {
        AudioMode::None => Ok(vec!["-an".to_owned()]),
        AudioMode::Auto if modifies_audio => Err(ApiError::invalid_input(
            "Choose AAC or Opus before changing audio bitrate or channels.",
        )),
        AudioMode::Auto if container == OutputContainer::Mkv => {
            Ok(vec!["-c:a".to_owned(), "copy".to_owned()])
        }
        AudioMode::Auto | AudioMode::Aac => Ok(converted_audio_arguments(
            streams, "aac", "aac", bitrate, channels,
        )),
        AudioMode::Copy => {
            if modifies_audio {
                return Err(ApiError::invalid_input(
                    "Original audio cannot change bitrate or channels. Choose an audio codec or automatic audio settings.",
                ));
            }
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
            Ok(converted_audio_arguments(
                streams, "opus", "libopus", bitrate, channels,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{audio_arguments, audio_bitrate_cap};
    use crate::ffmpeg::{AudioBitrate, AudioChannels, AudioMode, AudioStream, OutputContainer};

    fn default_audio_arguments(
        streams: &[AudioStream],
        container: OutputContainer,
        mode: AudioMode,
    ) -> super::ApiResult<Vec<String>> {
        audio_arguments(
            streams,
            container,
            mode,
            AudioBitrate::Auto,
            AudioChannels::Source,
        )
    }

    fn audio(codec: &str, channels: u32, bit_rate: Option<u64>) -> AudioStream {
        AudioStream {
            index: 0,
            codec: codec.to_owned(),
            channels: Some(channels),
            sample_rate: Some(48_000),
            bit_rate,
            language: None,
            title: None,
        }
    }

    #[test]
    fn never_raises_a_known_audio_bitrate() {
        assert_eq!(
            audio_bitrate_cap(
                &audio("opus", 2, Some(96_000)),
                AudioBitrate::Auto,
                AudioChannels::Source,
            ),
            96_000
        );
        assert_eq!(
            audio_bitrate_cap(
                &audio("opus", 2, Some(256_000)),
                AudioBitrate::Auto,
                AudioChannels::Source,
            ),
            160_000
        );
    }

    #[test]
    fn uses_channel_aware_caps_when_bitrate_is_unknown() {
        assert_eq!(
            audio_bitrate_cap(
                &audio("flac", 1, None),
                AudioBitrate::Auto,
                AudioChannels::Source,
            ),
            96_000
        );
        assert_eq!(
            audio_bitrate_cap(
                &audio("flac", 2, None),
                AudioBitrate::Auto,
                AudioChannels::Source,
            ),
            160_000
        );
        assert_eq!(
            audio_bitrate_cap(
                &audio("flac", 6, None),
                AudioBitrate::Auto,
                AudioChannels::Source,
            ),
            256_000
        );
    }

    #[test]
    fn audio_modes_copy_or_convert_each_track_explicitly() {
        let streams = vec![
            audio("aac", 2, Some(128_000)),
            audio("flac", 2, Some(900_000)),
        ];
        let automatic =
            default_audio_arguments(&streams, OutputContainer::Mp4, AudioMode::Auto).unwrap();
        assert!(automatic.windows(2).any(|pair| pair == ["-c:a:0", "copy"]));
        assert!(automatic.windows(2).any(|pair| pair == ["-c:a:1", "aac"]));

        let opus =
            default_audio_arguments(&streams, OutputContainer::Mkv, AudioMode::Opus).unwrap();
        assert!(opus.windows(2).any(|pair| pair == ["-c:a:0", "libopus"]));
        assert!(opus.windows(2).any(|pair| pair == ["-c:a:1", "libopus"]));
    }

    #[test]
    fn rejects_incompatible_audio_modes() {
        let streams = vec![audio("flac", 2, Some(900_000))];
        assert!(default_audio_arguments(&streams, OutputContainer::Mp4, AudioMode::Copy).is_err());
        assert!(default_audio_arguments(&streams, OutputContainer::Mp4, AudioMode::Opus).is_err());
        assert_eq!(
            default_audio_arguments(&streams, OutputContainer::Mkv, AudioMode::None).unwrap(),
            ["-an"]
        );
    }

    #[test]
    fn applies_requested_bitrate_and_downmix_without_raising_known_sources() {
        let streams = vec![
            audio("aac", 6, Some(320_000)),
            audio("aac", 1, Some(64_000)),
        ];

        let arguments = audio_arguments(
            &streams,
            OutputContainer::Mp4,
            AudioMode::Aac,
            AudioBitrate::Kbps128,
            AudioChannels::Stereo,
        )
        .unwrap();

        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-b:a:0", "128000"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-ac:a:0", "2"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-c:a:1", "copy"]));
        assert!(!arguments.iter().any(|argument| argument == "-ac:a:1"));
    }
}
