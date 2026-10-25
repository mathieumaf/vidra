mod audio;
mod video;

use self::{audio::audio_arguments, video::video_arguments};
use super::{
    validate_input, validate_output, AudioMode, AudioStream, EncodeRequest, ExistingOutput,
    MediaInfo, OutputContainer, SubtitleStream,
};
use crate::{
    error::{ApiError, ApiResult},
    jobs::PendingJob,
};
use std::{collections::HashSet, ffi::OsString, path::Path};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

// `-y` overwrites only the empty partial file created for this job. The
// destination is never an FFmpeg argument; `-n` cannot be used because that
// partial file already exists when FFmpeg starts.
const GLOBAL_ARGUMENTS: [&str; 4] = ["-hide_banner", "-nostdin", "-y", "-i"];

pub(super) fn validate_settings(request: &EncodeRequest, media: &MediaInfo) -> ApiResult<()> {
    video_arguments(request, media.video.as_ref())?;
    let audio_streams = selected_audio_streams(&media.audio, &request.audio_stream_indexes)?;
    validate_subtitle_streams(&media.subtitles, &request.subtitle_stream_indexes)?;
    audio_arguments(
        &audio_streams,
        request.container,
        request.audio_mode,
        request.audio_bitrate,
        request.audio_channels,
    )?;
    Ok(())
}

fn selected_audio_streams(streams: &[AudioStream], indexes: &[u32]) -> ApiResult<Vec<AudioStream>> {
    let mut unique = HashSet::with_capacity(indexes.len());
    indexes
        .iter()
        .map(|index| {
            if !unique.insert(*index) {
                return Err(ApiError::invalid_input(
                    "An audio track cannot be selected more than once.",
                ));
            }
            streams
                .iter()
                .find(|stream| stream.index == *index)
                .cloned()
                .ok_or_else(|| ApiError::invalid_input("A selected audio track is unavailable."))
        })
        .collect()
}

fn validate_subtitle_streams(streams: &[SubtitleStream], indexes: &[u32]) -> ApiResult<()> {
    let mut unique = HashSet::with_capacity(indexes.len());
    for index in indexes {
        if !unique.insert(*index) {
            return Err(ApiError::invalid_input(
                "A subtitle track cannot be selected more than once.",
            ));
        }
        if !streams.iter().any(|stream| stream.index == *index) {
            return Err(ApiError::invalid_input(
                "A selected subtitle track is unavailable.",
            ));
        }
    }
    Ok(())
}

fn mapping_arguments(request: &EncodeRequest, subtitles: &[SubtitleStream]) -> Vec<String> {
    let mut arguments = vec!["-map".to_owned(), "0:v:0?".to_owned()];
    if request.audio_mode != AudioMode::None {
        for index in &request.audio_stream_indexes {
            arguments.extend(["-map".to_owned(), format!("0:{index}")]);
        }
    }
    arguments.extend([
        "-map_metadata".to_owned(),
        if request.preserve_metadata { "0" } else { "-1" }.to_owned(),
        "-map_chapters".to_owned(),
        if request.preserve_chapters { "0" } else { "-1" }.to_owned(),
    ]);
    if request.preserve_subtitles {
        let mapped_subtitles = request
            .subtitle_stream_indexes
            .iter()
            .filter_map(|index| subtitles.iter().find(|stream| stream.index == *index))
            .filter(|stream| {
                request.container == OutputContainer::Mkv || is_mp4_text_subtitle(&stream.codec)
            })
            .collect::<Vec<_>>();
        for stream in &mapped_subtitles {
            arguments.extend(["-map".to_owned(), format!("0:{}", stream.index)]);
        }
        if !mapped_subtitles.is_empty() {
            arguments.extend(subtitle_codec_arguments(
                request.container,
                &mapped_subtitles,
            ));
        }
    }
    arguments
}

fn is_mp4_text_subtitle(codec: &str) -> bool {
    ["subrip", "ass", "ssa", "mov_text", "webvtt"]
        .iter()
        .any(|candidate| codec.eq_ignore_ascii_case(candidate))
}

/// Matroska cannot store MOV text. Convert that codec to SubRip and copy every
/// subtitle codec the container already accepts, including image tracks.
fn subtitle_codec_arguments(
    container: OutputContainer,
    subtitles: &[&SubtitleStream],
) -> Vec<String> {
    match container {
        OutputContainer::Mp4 => vec!["-c:s".to_owned(), "mov_text".to_owned()],
        OutputContainer::Mkv
            if subtitles
                .iter()
                .any(|stream| stream.codec.eq_ignore_ascii_case("mov_text")) =>
        {
            subtitles
                .iter()
                .enumerate()
                .flat_map(|(index, stream)| {
                    let codec = if stream.codec.eq_ignore_ascii_case("mov_text") {
                        "srt"
                    } else {
                        "copy"
                    };
                    [format!("-c:s:{index}"), codec.to_owned()]
                })
                .collect()
        }
        OutputContainer::Mkv => vec!["-c:s".to_owned(), "copy".to_owned()],
    }
}

pub(super) fn build_command(
    app: &AppHandle,
    job: &PendingJob,
    partial_output: &Path,
) -> ApiResult<tauri_plugin_shell::process::Command> {
    let arguments = command_arguments(job, partial_output)?;
    Ok(app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?
        .args(arguments)
        .env("AV_LOG_FORCE_NOCOLOR", "1"))
}

/// Arguments for one encode, including the validated source and the temporary
/// output. `build_command` passes this list to the FFmpeg sidecar unchanged.
pub(super) fn command_arguments(
    job: &PendingJob,
    partial_output: &Path,
) -> ApiResult<Vec<OsString>> {
    validate_settings(&job.request, &job.media)?;
    let input = validate_input(&job.request.input_path)?;
    let output = validate_output(
        &job.request.output_path,
        std::slice::from_ref(&input),
        job.request.container,
        ExistingOutput::for_request(&job.request),
    )?;
    crate::output::partial::ensure_partial_target(&output, partial_output)?;
    Ok(ffmpeg_arguments(
        &input,
        partial_output,
        &encoding_arguments(job)?,
    ))
}

#[cfg(test)]
pub(super) fn command_preview(
    job: &PendingJob,
    source: &Path,
    partial_output: &Path,
) -> ApiResult<Vec<String>> {
    validate_settings(&job.request, &job.media)?;
    crate::output::partial::ensure_partial_target(
        Path::new(&job.request.output_path),
        partial_output,
    )?;
    let arguments = ffmpeg_arguments(source, partial_output, &encoding_arguments(job)?);
    Ok(arguments
        .iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect())
}

fn ffmpeg_arguments(source: &Path, partial_output: &Path, encoding: &[String]) -> Vec<OsString> {
    let mut arguments = Vec::with_capacity(GLOBAL_ARGUMENTS.len() + encoding.len() + 2);
    arguments.extend(GLOBAL_ARGUMENTS.iter().copied().map(OsString::from));
    arguments.push(source.as_os_str().to_os_string());
    arguments.extend(encoding.iter().map(OsString::from));
    arguments.push(partial_output.as_os_str().to_os_string());
    arguments
}

fn encoding_arguments(job: &PendingJob) -> ApiResult<Vec<String>> {
    let request = &job.request;
    let audio_streams = selected_audio_streams(&job.media.audio, &request.audio_stream_indexes)?;
    let mut arguments = mapping_arguments(request, &job.media.subtitles);
    arguments.extend(video_arguments(request, job.media.video.as_ref())?);
    arguments.extend(audio_arguments(
        &audio_streams,
        request.container,
        request.audio_mode,
        request.audio_bitrate,
        request.audio_channels,
    )?);
    arguments.extend([
        "-progress".to_owned(),
        "pipe:1".to_owned(),
        "-nostats".to_owned(),
    ]);
    Ok(arguments)
}

pub(crate) fn redacted_command(job: &PendingJob) -> ApiResult<String> {
    validate_settings(&job.request, &job.media)?;
    let mut arguments = vec!["ffmpeg".to_owned()];
    arguments.extend(GLOBAL_ARGUMENTS.into_iter().map(str::to_owned));
    arguments.push("<source>".to_owned());
    arguments.extend(encoding_arguments(job)?);
    arguments.push("<output>".to_owned());
    Ok(arguments.join(" "))
}

#[cfg(test)]
mod tests {
    use super::{
        encoding_arguments, mapping_arguments, selected_audio_streams, validate_subtitle_streams,
        GLOBAL_ARGUMENTS,
    };
    use crate::{
        ffmpeg::{
            AudioBitrate, AudioChannels, AudioMode, AudioStream, AudioTrackMode, EncodeRequest,
            EncodingSpeed, MediaInfo, OutputContainer, OutputFrameRate, OutputResolution,
            QualityLevel, SubtitleStream, VideoCodec, VideoStream,
        },
        jobs::PendingJob,
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
            audio_stream_indexes: vec![1, 2],
            subtitle_stream_indexes: vec![3, 4],
            preserve_subtitles: true,
            preserve_metadata: true,
            preserve_chapters: true,
            replace_existing: false,
            allow_insufficient_disk_space: false,
        }
    }

    fn job(request: EncodeRequest, audio: Vec<AudioStream>) -> PendingJob {
        PendingJob {
            id: "job-1".to_owned(),
            estimated_output_bytes: 0,
            media: MediaInfo {
                path: request.input_path.clone(),
                name: "input.mov".to_owned(),
                duration_seconds: 10.0,
                size_bytes: 1_000,
                format_name: "mov,mp4".to_owned(),
                format_long_name: None,
                video: Some(VideoStream {
                    codec: "h264".to_owned(),
                    width: 1920,
                    height: 1080,
                    frame_rate: Some(30.0),
                    pixel_format: None,
                    bit_depth: None,
                    color_range: None,
                    color_space: None,
                    color_transfer: None,
                    color_primaries: None,
                    hdr_format: None,
                    dolby_vision: None,
                }),
                audio,
                subtitles: vec![],
                chapter_count: 0,
                has_metadata: false,
            },
            request,
            ffmpeg_version: None,
        }
    }

    #[test]
    fn ffmpeg_does_not_read_from_the_controlling_terminal() {
        assert!(GLOBAL_ARGUMENTS.contains(&"-nostdin"));
    }

    #[test]
    fn both_output_modes_send_ffmpeg_only_the_partial_file() {
        use std::path::Path;

        let partial = Path::new("/videos/.vidra-partial-job-1-abc123.mkv");
        let mut settings = request(OutputContainer::Mkv);
        settings.output_path = "/videos/holiday-vidra.mkv".to_owned();
        settings.audio_mode = AudioMode::None;
        settings.audio_stream_indexes.clear();
        settings.subtitle_stream_indexes.clear();
        settings.preserve_subtitles = false;
        let source = Path::new("/videos/holiday.mov");

        let mut rejecting = settings.clone();
        rejecting.replace_existing = false;
        let reject_arguments =
            super::command_preview(&job(rejecting, vec![]), source, partial).unwrap();

        let mut replacing = settings.clone();
        replacing.replace_existing = true;
        let replace_arguments =
            super::command_preview(&job(replacing, vec![]), source, partial).unwrap();

        assert_eq!(reject_arguments, replace_arguments);
        assert!(reject_arguments.iter().any(|argument| argument == "-y"));
        assert!(!reject_arguments.iter().any(|argument| argument == "-n"));
        assert_eq!(
            reject_arguments.last().map(String::as_str),
            partial.to_str()
        );
        assert!(reject_arguments
            .windows(2)
            .any(|pair| pair == ["-i", "/videos/holiday.mov"]));
        assert!(!reject_arguments
            .iter()
            .any(|argument| argument == "/videos/holiday-vidra.mkv"));

        let mut destination_settings = settings;
        destination_settings.output_path = "/output.mkv".to_owned();
        let destination = super::command_preview(
            &job(destination_settings, vec![]),
            source,
            Path::new("/output.mkv"),
        );
        assert_eq!(destination.unwrap_err().code, "invalid_input");
    }

    #[test]
    fn advanced_mapping_controls_tracks_and_source_information() {
        let mut request = request(OutputContainer::Mkv);
        request.audio_stream_indexes = vec![2];
        request.subtitle_stream_indexes = vec![4];
        request.preserve_metadata = false;
        request.preserve_chapters = false;
        let subtitles = vec![subtitle(3, "subrip"), subtitle(4, "hdmv_pgs_subtitle")];
        let arguments = mapping_arguments(&request, &subtitles);

        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:2"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:4"]));
        assert!(!arguments.iter().any(|argument| argument == "0:1"));
        assert!(!arguments.iter().any(|argument| argument == "0:3"));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-map_metadata", "-1"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-map_chapters", "-1"]));

        request.container = OutputContainer::Mp4;
        assert!(!mapping_arguments(&request, &subtitles)
            .iter()
            .any(|argument| argument == "0:4"));

        request.audio_mode = AudioMode::None;
        assert!(!mapping_arguments(&request, &subtitles)
            .iter()
            .any(|argument| argument == "0:2"));
    }

    #[test]
    fn mp4_converts_text_subtitles_and_excludes_image_subtitles() {
        let mut request = request(OutputContainer::Mp4);
        request.subtitle_stream_indexes = vec![3, 4, 5, 6, 7];
        let subtitles = vec![
            subtitle(3, "subrip"),
            subtitle(4, "ass"),
            subtitle(5, "hdmv_pgs_subtitle"),
            subtitle(6, "dvd_subtitle"),
            subtitle(7, "webvtt"),
        ];

        let arguments = mapping_arguments(&request, &subtitles);

        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:3"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:4"]));
        assert!(!arguments.iter().any(|argument| argument == "0:5"));
        assert!(!arguments.iter().any(|argument| argument == "0:6"));
        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:7"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-c:s", "mov_text"]));
    }

    #[test]
    fn mkv_copies_text_and_image_subtitles() {
        let mut request = request(OutputContainer::Mkv);
        request.subtitle_stream_indexes = vec![3, 4];
        let subtitles = vec![subtitle(3, "ass"), subtitle(4, "hdmv_pgs_subtitle")];

        let arguments = mapping_arguments(&request, &subtitles);

        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:3"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-map", "0:4"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-c:s", "copy"]));
        assert!(!arguments.iter().any(|argument| argument == "mov_text"));
    }

    #[test]
    fn mkv_converts_mov_text_and_still_copies_image_subtitles() {
        let mut request = request(OutputContainer::Mkv);
        request.subtitle_stream_indexes = vec![3, 4];
        let subtitles = vec![subtitle(3, "mov_text"), subtitle(4, "hdmv_pgs_subtitle")];

        let arguments = mapping_arguments(&request, &subtitles);

        assert!(arguments.windows(2).any(|pair| pair == ["-c:s:0", "srt"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-c:s:1", "copy"]));
        assert!(!arguments.windows(2).any(|pair| pair == ["-c:s", "copy"]));
    }

    #[test]
    fn mp4_av1_keeps_the_regular_mp4_audio_rules() {
        let mut request = request(OutputContainer::Mp4);
        request.video_codec = VideoCodec::Av1;
        request.subtitle_stream_indexes = vec![];
        let audio = vec![
            AudioStream {
                index: 1,
                codec: "aac".to_owned(),
                channels: Some(2),
                sample_rate: Some(48_000),
                bit_rate: Some(128_000),
                language: None,
                title: None,
            },
            AudioStream {
                index: 2,
                codec: "flac".to_owned(),
                channels: Some(2),
                sample_rate: Some(48_000),
                bit_rate: Some(900_000),
                language: None,
                title: None,
            },
        ];

        let arguments = encoding_arguments(&job(request, audio)).unwrap();

        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-c:v", "libsvtav1"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-tag:v", "av01"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-c:a:0", "copy"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-c:a:1", "aac"]));
    }

    #[test]
    fn validates_source_specific_track_indexes() {
        let audio = vec![AudioStream {
            index: 1,
            codec: "aac".to_owned(),
            channels: Some(2),
            sample_rate: Some(48_000),
            bit_rate: Some(128_000),
            language: Some("eng".to_owned()),
            title: None,
        }];
        let subtitles = vec![SubtitleStream {
            index: 2,
            codec: "subrip".to_owned(),
            language: Some("fra".to_owned()),
            title: None,
            is_default: true,
            is_forced: false,
        }];

        assert_eq!(selected_audio_streams(&audio, &[1]).unwrap()[0].index, 1);
        assert!(selected_audio_streams(&audio, &[1, 1]).is_err());
        assert!(selected_audio_streams(&audio, &[3]).is_err());
        assert!(validate_subtitle_streams(&subtitles, &[2]).is_ok());
        assert!(validate_subtitle_streams(&subtitles, &[2, 2]).is_err());
        assert!(validate_subtitle_streams(&subtitles, &[3]).is_err());
    }

    fn subtitle(index: u32, codec: &str) -> SubtitleStream {
        SubtitleStream {
            index,
            codec: codec.to_owned(),
            language: None,
            title: None,
            is_default: false,
            is_forced: false,
        }
    }
}
