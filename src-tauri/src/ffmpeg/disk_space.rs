use super::{AudioMode, EncodeRequest, MediaInfo, QualityLevel, VideoCodec};
use crate::error::{ApiError, ApiResult};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

const CONTAINER_OVERHEAD_FACTOR: f64 = 1.08;
const FIXED_OVERHEAD_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct VolumeSpace {
    id: u64,
    available_bytes: u64,
}

#[derive(Debug)]
struct VolumeRequirement {
    available_bytes: u64,
    estimated_bytes: u64,
    recoverable_bytes: u64,
    all_overridden: bool,
}

pub(super) fn ensure_available(requests: &[(EncodeRequest, MediaInfo)]) -> ApiResult<()> {
    ensure_available_with(requests, destination_space)
}

fn ensure_available_with(
    requests: &[(EncodeRequest, MediaInfo)],
    mut space_for: impl FnMut(&Path) -> Option<VolumeSpace>,
) -> ApiResult<()> {
    let mut volumes = HashMap::<u64, VolumeRequirement>::new();

    for (request, media) in requests {
        let output = PathBuf::from(&request.output_path);
        let Some(space) = space_for(&output) else {
            continue;
        };
        let requirement = volumes
            .entry(space.id)
            .or_insert_with(|| VolumeRequirement {
                available_bytes: space.available_bytes,
                estimated_bytes: 0,
                recoverable_bytes: 0,
                all_overridden: true,
            });
        requirement.available_bytes = requirement.available_bytes.min(space.available_bytes);
        requirement.estimated_bytes = requirement
            .estimated_bytes
            .saturating_add(estimated_output_bytes(request, media));
        requirement.all_overridden &= request.allow_insufficient_disk_space;
        if request.replace_existing {
            requirement.recoverable_bytes = requirement.recoverable_bytes.saturating_add(
                output
                    .metadata()
                    .ok()
                    .filter(|metadata| metadata.is_file())
                    .map_or(0, |metadata| metadata.len()),
            );
        }
    }

    if let Some(requirement) = volumes.values().find(|requirement| {
        !requirement.all_overridden
            && requirement.estimated_bytes
                > requirement
                    .available_bytes
                    .saturating_add(requirement.recoverable_bytes)
    }) {
        let available = requirement
            .available_bytes
            .saturating_add(requirement.recoverable_bytes);
        return Err(ApiError::new(
            "insufficient_disk_space",
            format!(
                "This conversion may need about {}, but the destination has about {} available. Free up space, choose another destination, or proceed anyway.",
                format_bytes(requirement.estimated_bytes),
                format_bytes(available),
            ),
        ));
    }

    Ok(())
}

pub(super) fn estimated_output_bytes(request: &EncodeRequest, media: &MediaInfo) -> u64 {
    if request.video_codec == VideoCodec::Copy {
        return with_overhead(media.size_bytes);
    }

    let source_projection = source_size_projection(request, media);
    let duration_projection = duration_projection(request, media);
    let estimate = match (source_projection, duration_projection) {
        (Some(source), Some(duration)) => source.min(duration),
        (Some(source), None) => source,
        (None, Some(duration)) => duration,
        (None, None) => 0,
    };
    with_overhead(estimate)
}

fn source_size_projection(request: &EncodeRequest, media: &MediaInfo) -> Option<u64> {
    if media.size_bytes == 0 {
        return None;
    }
    let codec_factor = match request.video_codec {
        VideoCodec::H264 => 1.0,
        VideoCodec::H265 => 0.72,
        VideoCodec::Av1 => 0.58,
        VideoCodec::Copy => 1.0,
    };
    let quality_factor = match request.quality {
        QualityLevel::MaximumCompression => 0.34,
        QualityLevel::SmallerFile => 0.50,
        QualityLevel::Balanced => 0.70,
        QualityLevel::HighQuality => 0.95,
        QualityLevel::NearSource => 1.20,
    };
    let tuning_factor = 1.0 + f64::from(request.quality_tuning) * 0.12;
    let resolution_factor = output_pixel_ratio(request, media).powf(0.65);
    let frame_rate_factor = output_frame_rate_ratio(request, media).powf(0.65);
    Some(saturating_f64_to_u64(
        media.size_bytes as f64
            * codec_factor
            * quality_factor
            * tuning_factor
            * resolution_factor
            * frame_rate_factor,
    ))
}

fn duration_projection(request: &EncodeRequest, media: &MediaInfo) -> Option<u64> {
    if !media.duration_seconds.is_finite() || media.duration_seconds <= 0.0 {
        return None;
    }

    let video_bits_per_second = media.video.as_ref().map_or(0.0, |video| {
        let balanced_1080p = match request.video_codec {
            VideoCodec::H264 => 8_000_000.0,
            VideoCodec::H265 => 5_000_000.0,
            VideoCodec::Av1 => 4_000_000.0,
            VideoCodec::Copy => 0.0,
        };
        let quality_factor = match request.quality {
            QualityLevel::MaximumCompression => 0.45,
            QualityLevel::SmallerFile => 0.70,
            QualityLevel::Balanced => 1.0,
            QualityLevel::HighQuality => 1.45,
            QualityLevel::NearSource => 2.0,
        };
        let tuning_factor = 1.0 + f64::from(request.quality_tuning) * 0.12;
        let source_pixels = u64::from(video.width) * u64::from(video.height);
        let pixel_scale =
            source_pixels as f64 * output_pixel_ratio(request, media) / f64::from(1920 * 1080);
        let frame_rate_scale =
            video.frame_rate.unwrap_or(30.0) * output_frame_rate_ratio(request, media) / 30.0;
        balanced_1080p * quality_factor * tuning_factor * pixel_scale * frame_rate_scale
    });
    let total_bits_per_second =
        video_bits_per_second + estimated_audio_bits_per_second(request, media) as f64;
    Some(saturating_f64_to_u64(
        total_bits_per_second * media.duration_seconds / 8.0,
    ))
}

fn estimated_audio_bits_per_second(request: &EncodeRequest, media: &MediaInfo) -> u64 {
    if request.audio_mode == AudioMode::None {
        return 0;
    }

    media
        .audio
        .iter()
        .filter(|stream| request.audio_stream_indexes.contains(&stream.index))
        .map(|stream| {
            let channels = request
                .audio_channels
                .maximum()
                .map(|maximum| stream.channels.unwrap_or(maximum).min(maximum))
                .unwrap_or_else(|| stream.channels.unwrap_or(2));
            let default = match channels {
                0 | 1 => 96_000,
                2 => 160_000,
                _ => 256_000,
            };
            let source = stream
                .bit_rate
                .filter(|value| *value > 0)
                .unwrap_or(default);
            if matches!(request.audio_mode, AudioMode::Aac | AudioMode::Opus) {
                source.min(request.audio_bitrate.bits_per_second().unwrap_or(default))
            } else {
                source
            }
        })
        .fold(0_u64, u64::saturating_add)
}

fn output_pixel_ratio(request: &EncodeRequest, media: &MediaInfo) -> f64 {
    let Some(video) = &media.video else {
        return 1.0;
    };
    let Some((landscape_width, landscape_height)) = request.output_resolution.landscape_bounds()
    else {
        return 1.0;
    };
    let (maximum_width, maximum_height) = if video.width >= video.height {
        (landscape_width, landscape_height)
    } else {
        (landscape_height, landscape_width)
    };
    let width_scale = f64::from(maximum_width) / f64::from(video.width.max(1));
    let height_scale = f64::from(maximum_height) / f64::from(video.height.max(1));
    width_scale.min(height_scale).min(1.0).powi(2)
}

fn output_frame_rate_ratio(request: &EncodeRequest, media: &MediaInfo) -> f64 {
    let Some(source) = media.video.as_ref().and_then(|video| video.frame_rate) else {
        return 1.0;
    };
    let Some(target) = request.output_frame_rate.value() else {
        return 1.0;
    };
    (f64::from(target) / source.max(1.0)).min(1.0)
}

fn with_overhead(bytes: u64) -> u64 {
    saturating_f64_to_u64(bytes as f64 * CONTAINER_OVERHEAD_FACTOR)
        .saturating_add(FIXED_OVERHEAD_BYTES)
}

fn saturating_f64_to_u64(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        0
    } else if value >= u64::MAX as f64 {
        u64::MAX
    } else {
        value.ceil() as u64
    }
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit < 2 {
        format!("{value:.0} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(unix)]
fn destination_space(output: &Path) -> Option<VolumeSpace> {
    use std::{
        ffi::CString,
        mem::MaybeUninit,
        os::unix::{ffi::OsStrExt, fs::MetadataExt},
    };

    let parent = output.parent()?;
    let id = parent.metadata().ok()?.dev();
    let path = CString::new(parent.as_os_str().as_bytes()).ok()?;
    let mut statistics = MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is NUL-terminated and `statistics` points to valid writable memory.
    if unsafe { libc::statvfs(path.as_ptr(), statistics.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: a successful `statvfs` call initialized the structure.
    let statistics = unsafe { statistics.assume_init() };
    let available = u128::from(statistics.f_bavail) * u128::from(statistics.f_frsize);
    Some(VolumeSpace {
        id,
        available_bytes: available.min(u128::from(u64::MAX)) as u64,
    })
}

#[cfg(not(unix))]
fn destination_space(_output: &Path) -> Option<VolumeSpace> {
    None
}

#[cfg(test)]
mod tests {
    use super::{ensure_available_with, estimated_output_bytes, VolumeSpace};
    use crate::ffmpeg::{
        AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodeRequest, EncodingSpeed,
        MediaInfo, OutputContainer, OutputFrameRate, OutputResolution, QualityLevel, VideoCodec,
        VideoStream,
    };
    use std::path::Path;

    fn request() -> EncodeRequest {
        EncodeRequest {
            input_path: "/source.mov".to_owned(),
            output_path: "/destination/output.mp4".to_owned(),
            quality: QualityLevel::Balanced,
            container: OutputContainer::Mp4,
            video_codec: VideoCodec::H264,
            encoding_speed: EncodingSpeed::Efficient,
            audio_mode: AudioMode::None,
            output_resolution: OutputResolution::Source,
            output_frame_rate: OutputFrameRate::Source,
            quality_tuning: 0,
            audio_bitrate: AudioBitrate::Auto,
            audio_channels: AudioChannels::Source,
            audio_track_mode: AudioTrackMode::All,
            audio_stream_indexes: vec![],
            subtitle_stream_indexes: vec![],
            preserve_subtitles: false,
            preserve_metadata: false,
            preserve_chapters: false,
            replace_existing: false,
            allow_insufficient_disk_space: false,
        }
    }

    fn media() -> MediaInfo {
        MediaInfo {
            path: "/source.mov".to_owned(),
            name: "source.mov".to_owned(),
            duration_seconds: 600.0,
            size_bytes: 8_000_000_000,
            format_name: "mov".to_owned(),
            format_long_name: None,
            video: Some(VideoStream {
                codec: "prores".to_owned(),
                width: 3840,
                height: 2160,
                frame_rate: Some(30.0),
                pixel_format: Some("yuv422p10le".to_owned()),
                bit_depth: Some(10),
                color_range: None,
                color_space: None,
                color_transfer: None,
                color_primaries: None,
                hdr_format: None,
                dolby_vision: None,
            }),
            audio: vec![],
            subtitles: vec![],
            chapter_count: 0,
            has_metadata: false,
        }
    }

    #[test]
    fn estimate_accounts_for_codec_quality_resolution_and_duration() {
        let source = media();
        let mut settings = request();
        let balanced_h264 = estimated_output_bytes(&settings, &source);

        settings.quality = QualityLevel::NearSource;
        let near_source = estimated_output_bytes(&settings, &source);
        assert!(near_source > balanced_h264);

        settings.quality = QualityLevel::Balanced;
        settings.video_codec = VideoCodec::H265;
        let h265 = estimated_output_bytes(&settings, &source);
        assert!(h265 < balanced_h264);

        settings.video_codec = VideoCodec::H264;
        settings.output_resolution = OutputResolution::P1080;
        let hd = estimated_output_bytes(&settings, &source);
        assert!(hd < balanced_h264);

        let mut longer_source = source.clone();
        longer_source.duration_seconds *= 2.0;
        assert!(estimated_output_bytes(&request(), &longer_source) > balanced_h264);
    }

    #[test]
    fn copied_video_estimate_keeps_a_conservative_overhead() {
        let source = media();
        let mut settings = request();
        settings.video_codec = VideoCodec::Copy;

        assert!(estimated_output_bytes(&settings, &source) > source.size_bytes);
    }

    #[test]
    fn rejects_an_obviously_impossible_batch_before_it_is_queued() {
        let jobs = vec![(request(), media()), (request(), media())];
        let error = ensure_available_with(&jobs, |_| {
            Some(VolumeSpace {
                id: 7,
                available_bytes: 1024,
            })
        })
        .expect_err("the batch should not fit");

        assert_eq!(error.code, "insufficient_disk_space");
        assert!(error.message.contains("may need about"));
        assert!(error.message.contains("Free up space"));
        assert!(error.message.contains("proceed anyway"));
    }

    #[test]
    fn allows_plenty_of_space_and_an_explicit_override() {
        let source = media();
        let mut settings = request();
        let estimated = estimated_output_bytes(&settings, &source);
        let jobs = vec![(settings.clone(), source.clone())];
        assert!(ensure_available_with(&jobs, |_| {
            Some(VolumeSpace {
                id: 7,
                available_bytes: estimated.saturating_mul(2),
            })
        })
        .is_ok());

        settings.allow_insufficient_disk_space = true;
        assert!(ensure_available_with(&[(settings, source)], |_| {
            Some(VolumeSpace {
                id: 7,
                available_bytes: 0,
            })
        })
        .is_ok());
    }

    #[test]
    fn checks_batch_totals_per_destination_volume() {
        let source = media();
        let settings = request();
        let one_output = estimated_output_bytes(&settings, &source);
        let jobs = vec![(settings.clone(), source.clone()), (settings, source)];

        let result = ensure_available_with(&jobs, |path: &Path| {
            assert_eq!(path, Path::new("/destination/output.mp4"));
            Some(VolumeSpace {
                id: 42,
                available_bytes: one_output.saturating_add(1),
            })
        });

        assert!(result.is_err());
    }
}
