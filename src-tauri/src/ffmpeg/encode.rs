mod audio;
mod video;

use self::{audio::audio_arguments, video::video_arguments};
use super::{
    validate_input, validate_output, AudioStream, AudioTrackMode, EncodeRequest, MediaInfo,
    OutputContainer,
};
use crate::{
    error::{ApiError, ApiResult},
    jobs::PendingJob,
};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

const GLOBAL_ARGUMENTS: [&str; 4] = ["-hide_banner", "-nostdin", "-y", "-i"];

pub(super) fn validate_settings(request: &EncodeRequest, media: &MediaInfo) -> ApiResult<()> {
    video_arguments(request, media.video.as_ref())?;
    audio_arguments(
        selected_audio_streams(&media.audio, request.audio_track_mode),
        request.container,
        request.audio_mode,
        request.audio_bitrate,
        request.audio_channels,
    )?;
    Ok(())
}

fn selected_audio_streams(streams: &[AudioStream], mode: AudioTrackMode) -> &[AudioStream] {
    match mode {
        AudioTrackMode::All => streams,
        AudioTrackMode::First => &streams[..streams.len().min(1)],
    }
}

fn mapping_arguments(request: &EncodeRequest) -> Vec<&'static str> {
    let mut arguments = vec![
        "-map",
        "0:v:0?",
        "-map",
        match request.audio_track_mode {
            AudioTrackMode::All => "0:a?",
            AudioTrackMode::First => "0:a:0?",
        },
        "-map_metadata",
        if request.preserve_metadata { "0" } else { "-1" },
        "-map_chapters",
        if request.preserve_chapters { "0" } else { "-1" },
    ];
    if request.container == OutputContainer::Mkv && request.preserve_subtitles {
        arguments.extend(["-map", "0:s?", "-c:s", "copy"]);
    }
    arguments
}

pub(super) fn build_command(
    app: &AppHandle,
    job: &PendingJob,
) -> ApiResult<tauri_plugin_shell::process::Command> {
    validate_settings(&job.request, &job.media)?;
    let input = validate_input(&job.request.input_path)?;
    let output = validate_output(&job.request.output_path, &input, job.request.container)?;
    let audio_streams = selected_audio_streams(&job.media.audio, job.request.audio_track_mode);
    let command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?
        .args(GLOBAL_ARGUMENTS)
        .arg(input.as_os_str())
        .args(mapping_arguments(&job.request))
        .args(video_arguments(&job.request, job.media.video.as_ref())?);

    Ok(command
        .args(audio_arguments(
            audio_streams,
            job.request.container,
            job.request.audio_mode,
            job.request.audio_bitrate,
            job.request.audio_channels,
        )?)
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(output.as_os_str())
        .env("AV_LOG_FORCE_NOCOLOR", "1"))
}

#[cfg(test)]
mod tests {
    use super::{mapping_arguments, GLOBAL_ARGUMENTS};
    use crate::ffmpeg::{
        AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodeRequest, EncodingSpeed,
        OutputContainer, OutputFrameRate, OutputResolution, QualityLevel, VideoCodec,
    };

    fn request(container: OutputContainer) -> EncodeRequest {
        EncodeRequest {
            input_path: "/input.mov".to_owned(),
            output_path: "/output.mkv".to_owned(),
            quality: QualityLevel::Balanced,
            container,
            video_codec: VideoCodec::H264,
            encoding_speed: EncodingSpeed::Efficient,
            audio_mode: AudioMode::Auto,
            output_resolution: OutputResolution::Source,
            output_frame_rate: OutputFrameRate::Source,
            quality_tuning: 0,
            audio_bitrate: AudioBitrate::Auto,
            audio_channels: AudioChannels::Source,
            audio_track_mode: AudioTrackMode::All,
            preserve_subtitles: true,
            preserve_metadata: true,
            preserve_chapters: true,
        }
    }

    #[test]
    fn ffmpeg_does_not_read_from_the_controlling_terminal() {
        assert!(GLOBAL_ARGUMENTS.contains(&"-nostdin"));
    }

    #[test]
    fn advanced_mapping_controls_tracks_and_source_information() {
        let mut request = request(OutputContainer::Mkv);
        request.audio_track_mode = AudioTrackMode::First;
        request.preserve_metadata = false;
        request.preserve_chapters = false;
        let arguments = mapping_arguments(&request);

        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:a:0?"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:s?"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-map_metadata", "-1"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-map_chapters", "-1"]));

        request.container = OutputContainer::Mp4;
        assert!(!mapping_arguments(&request).contains(&"0:s?"));
    }
}
