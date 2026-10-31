//! Timeline adjustments for a trimmed conversion.
//!
//! Original video starts on the previous keyframe, while a re-encode starts on
//! the requested frame. Chapters and text subtitles are rewritten onto that
//! output timeline and clipped so they cannot extend the file.

use super::{
    trim::{self, format_timestamp},
    version::host_target_triple,
    SegmentTrim, VideoCodec,
};
use crate::{
    error::{ApiError, ApiResult},
    jobs::PendingJob,
};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::AppHandle;

const MILLISECOND: f64 = 0.001;

#[derive(Debug)]
pub(crate) struct PreparedSegment {
    pub output_start: f64,
    pub output_end: f64,
    pub directory: PathBuf,
    pub chapter_file: Option<PathBuf>,
    pub text_subtitle_files: Vec<PathBuf>,
    pub image_subtitle_count: usize,
    /// Stream copy normalizes timestamps while muxing. Text cues are added in
    /// a second copy after that, so their times stay on the output timeline.
    pub remux_text_subtitles: bool,
}

pub(crate) struct SegmentInputs {
    pub extra: Vec<PathBuf>,
    pub chapter_index: Option<usize>,
    pub text_indexes: Vec<usize>,
    pub replace_text: bool,
    pub copy_source_subtitles: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cue {
    pub start: f64,
    pub end: f64,
    pub body: String,
}

static PREPARED: Mutex<Vec<(String, PreparedSegment)>> = Mutex::new(Vec::new());

pub(crate) fn store(job_id: &str, segment: PreparedSegment) {
    let mut prepared = PREPARED.lock().unwrap_or_else(|error| error.into_inner());
    prepared.retain(|(id, _)| id != job_id);
    prepared.push((job_id.to_owned(), segment));
}

pub(crate) fn peek(job_id: &str) -> Option<(f64, f64)> {
    let prepared = PREPARED.lock().unwrap_or_else(|error| error.into_inner());
    prepared
        .iter()
        .find(|(id, _)| id == job_id)
        .map(|(_, segment)| (segment.output_start, segment.output_end))
}

pub(crate) fn take(job_id: &str) -> Option<PreparedSegment> {
    let mut prepared = PREPARED.lock().unwrap_or_else(|error| error.into_inner());
    let index = prepared.iter().position(|(id, _)| id == job_id)?;
    Some(prepared.remove(index).1)
}

pub(crate) fn discard(job_id: &str) {
    if let Some(segment) = take(job_id) {
        let _ = fs::remove_dir_all(segment.directory);
    }
}

/// The source time where the output picture starts.
pub(crate) fn output_start_seconds(
    trim: Option<SegmentTrim>,
    duration_seconds: f64,
    copy_video: bool,
    keyframe_at_or_before_start: Option<f64>,
) -> Option<f64> {
    let segment = trim::normalize_trim(trim, duration_seconds)
        .ok()
        .flatten()?;
    if copy_video {
        Some(
            keyframe_at_or_before_start
                .filter(|keyframe| *keyframe <= segment.start_seconds + MILLISECOND)
                .unwrap_or(0.0),
        )
    } else {
        Some(segment.start_seconds)
    }
}

pub(crate) fn watched_duration(
    trim: Option<SegmentTrim>,
    source_duration: f64,
    output_start: Option<f64>,
) -> f64 {
    let Some(segment) = trim::normalize_trim(trim, source_duration).ok().flatten() else {
        return source_duration;
    };
    let start = output_start.unwrap_or(segment.start_seconds);
    (segment.end_seconds - start).max(MILLISECOND)
}

pub(crate) fn keyframe_at_or_before(times: &[f64], start: f64) -> Option<f64> {
    times
        .iter()
        .copied()
        .filter(|time| time.is_finite() && *time <= start + MILLISECOND)
        .max_by(f64::total_cmp)
}

pub(crate) fn parse_keyframe_times(output: &str) -> Vec<f64> {
    output
        .lines()
        .filter_map(|line| {
            let time = line.trim().trim_end_matches(',').trim();
            if time.is_empty() {
                None
            } else {
                time.parse::<f64>().ok().filter(|time| time.is_finite())
            }
        })
        .collect()
}

pub(crate) fn clip_cue(
    start: f64,
    end: f64,
    window_start: f64,
    window_end: f64,
) -> Option<(f64, f64)> {
    if !start.is_finite() || !end.is_finite() || end <= start {
        return None;
    }
    let start = start.max(window_start);
    let end = end.min(window_end);
    if end - start < MILLISECOND {
        None
    } else {
        Some((start - window_start, end - window_start))
    }
}

pub(crate) fn clip_cues(cues: &[Cue], window_start: f64, window_end: f64) -> Vec<Cue> {
    cues.iter()
        .filter_map(|cue| {
            let (start, end) = clip_cue(cue.start, cue.end, window_start, window_end)?;
            Some(Cue {
                start,
                end,
                body: cue.body.clone(),
            })
        })
        .collect()
}

pub(crate) fn parse_srt(text: &str) -> Vec<Cue> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    normalized
        .split("\n\n")
        .filter_map(|block| {
            let mut lines = block.lines().filter(|line| !line.trim().is_empty());
            let first = lines.next()?;
            let (times, body_first) = if first.contains("-->") {
                (first, None)
            } else {
                (lines.next()?, Some(first))
            };
            let (start, end) = parse_srt_range(times)?;
            let mut body = Vec::new();
            if let Some(line) = body_first {
                if !line
                    .trim()
                    .chars()
                    .all(|character| character.is_ascii_digit())
                {
                    body.push(line.to_owned());
                }
            }
            body.extend(lines.map(str::to_owned));
            let body = body.join("\n").trim().to_owned();
            if body.is_empty() {
                None
            } else {
                Some(Cue { start, end, body })
            }
        })
        .collect()
}

pub(crate) fn write_srt(cues: &[Cue]) -> String {
    let mut output = String::new();
    for (index, cue) in cues.iter().enumerate() {
        if index > 0 {
            output.push('\n');
        }
        output.push_str(&format!(
            "{}\n{} --> {}\n{}\n",
            index + 1,
            format_srt_time(cue.start),
            format_srt_time(cue.end),
            cue.body
        ));
    }
    output
}

pub(crate) fn chapter_metadata(
    chapters: &[crate::ffmpeg::ChapterMark],
    window_start: f64,
    window_end: f64,
) -> Option<String> {
    let mut blocks = Vec::new();
    for chapter in chapters {
        let Some((start, end)) = clip_cue(
            chapter.start_seconds,
            chapter.end_seconds,
            window_start,
            window_end,
        ) else {
            continue;
        };
        let mut block = format!(
            "[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\n",
            (start * 1000.0).round().max(0.0) as u64,
            (end * 1000.0).round().max(0.0) as u64,
        );
        if let Some(title) = chapter
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
        {
            block.push_str("title=");
            block.push_str(&escape_metadata(title));
            block.push('\n');
        }
        blocks.push(block);
    }
    if blocks.is_empty() {
        None
    } else {
        Some(format!(";FFMETADATA1\n{}", blocks.join("\n")))
    }
}

pub(crate) fn is_text_subtitle(codec: &str) -> bool {
    matches!(
        codec.to_ascii_lowercase().as_str(),
        "subrip" | "srt" | "ass" | "ssa" | "mov_text" | "webvtt" | "text"
    )
}

pub(crate) fn prepare(app: &AppHandle, job: &PendingJob) -> ApiResult<Option<PreparedSegment>> {
    let Some(segment) = trim::normalize_trim(job.request.trim, job.media.duration_seconds)? else {
        return Ok(None);
    };
    let copy_video = job.request.video_codec == VideoCodec::Copy;
    let keyframe = if copy_video {
        Some(read_keyframe(
            app,
            &job.request.input_path,
            segment.start_seconds,
        )?)
    } else {
        None
    };
    let output_start = output_start_seconds(
        job.request.trim,
        job.media.duration_seconds,
        copy_video,
        keyframe,
    )
    .unwrap_or(segment.start_seconds);
    let output_end = segment.end_seconds;
    let directory = std::env::temp_dir().join(format!("vidra-segment-{}", sanitize(&job.id)));
    fs::create_dir_all(&directory).map_err(|error| {
        ApiError::ffmpeg(format!("Could not prepare the segment files: {error}"))
    })?;

    let chapter_file = if job.request.preserve_chapters {
        chapter_metadata(&job.media.chapters, output_start, output_end)
            .map(|metadata| write_file(&directory.join("chapters.txt"), &metadata))
            .transpose()?
    } else {
        None
    };

    let image_subtitle_count = selected_image_subtitles(job).len();
    let mut text_subtitle_files = Vec::new();
    for subtitle in selected_text_subtitles(job) {
        let extracted = directory.join(format!("source-{}.srt", subtitle.index));
        extract_srt(app, &job.request.input_path, subtitle.index, &extracted)?;
        let cues = clip_cues(
            &parse_srt(&fs::read_to_string(&extracted).unwrap_or_default()),
            output_start,
            output_end,
        );
        if cues.is_empty() {
            continue;
        }
        let clipped = directory.join(format!("clipped-{}.srt", subtitle.index));
        write_file(&clipped, &write_srt(&cues))?;
        text_subtitle_files.push(clipped);
    }

    Ok(Some(PreparedSegment {
        output_start,
        output_end,
        directory,
        chapter_file,
        text_subtitle_files,
        image_subtitle_count,
        remux_text_subtitles: copy_video,
    }))
}

pub(crate) fn inputs_for(job_id: &str) -> Option<SegmentInputs> {
    let prepared = PREPARED.lock().unwrap_or_else(|error| error.into_inner());
    let segment = prepared.iter().find(|(id, _)| id == job_id)?;
    Some(segment_inputs(&segment.1))
}

fn segment_inputs(segment: &PreparedSegment) -> SegmentInputs {
    let extra = extra_inputs(segment);
    let text_indexes = text_input_indexes(segment);
    let chapter_index = chapter_input_index(segment);
    SegmentInputs {
        replace_text: segment.remux_text_subtitles || !segment.text_subtitle_files.is_empty(),
        copy_source_subtitles: segment.image_subtitle_count > 0,
        extra,
        chapter_index,
        text_indexes,
    }
}

pub(crate) fn extra_inputs(segment: &PreparedSegment) -> Vec<PathBuf> {
    let mut inputs = Vec::new();
    if !segment.remux_text_subtitles {
        inputs.extend(segment.text_subtitle_files.iter().cloned());
    }
    if let Some(chapters) = &segment.chapter_file {
        inputs.push(chapters.clone());
    }
    inputs
}

pub(crate) fn chapter_input_index(segment: &PreparedSegment) -> Option<usize> {
    segment
        .chapter_file
        .as_ref()
        .map(|_| extra_inputs(segment).len())
}

pub(crate) fn text_input_indexes(segment: &PreparedSegment) -> Vec<usize> {
    if segment.remux_text_subtitles {
        Vec::new()
    } else {
        (1..=segment.text_subtitle_files.len()).collect()
    }
}

pub(crate) async fn keyframe_before(
    app: &AppHandle,
    path: &str,
    start_seconds: f64,
) -> ApiResult<f64> {
    let input = super::paths::validate_input(path)?;
    read_keyframe_from_path(app, &input, start_seconds)
}

fn read_keyframe(app: &AppHandle, path: &str, start_seconds: f64) -> ApiResult<f64> {
    let input = super::paths::validate_input(path)?;
    read_keyframe_from_path_sync(app, &input, start_seconds)
}

fn read_keyframe_from_path(app: &AppHandle, input: &Path, start_seconds: f64) -> ApiResult<f64> {
    // The async command and the synchronous encode path share the parser.
    read_keyframe_from_path_sync(app, input, start_seconds)
}

fn read_keyframe_from_path_sync(
    app: &AppHandle,
    input: &Path,
    start_seconds: f64,
) -> ApiResult<f64> {
    let _ = app;
    let output = run_sidecar(
        "ffprobe",
        &[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-skip_frame",
            "nokey",
            "-read_intervals",
            &format!("0%{}", format_timestamp(start_seconds.max(0.0))),
            "-show_entries",
            "frame=pts_time",
            "-of",
            "csv=p=0",
        ],
        input,
    )?;
    Ok(keyframe_at_or_before(&parse_keyframe_times(&output), start_seconds).unwrap_or(0.0))
}

fn extract_srt(app: &AppHandle, source: &str, index: u32, destination: &Path) -> ApiResult<()> {
    let _ = app;
    let source = super::paths::validate_input(source)?;
    let status = Command::new(sidecar_path("ffmpeg")?)
        .args(["-hide_banner", "-nostdin", "-y", "-i"])
        .arg(&source)
        .args(["-map", &format!("0:{index}"), "-f", "srt"])
        .arg(destination)
        .output()
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?;
    if !status.status.success() {
        return Err(ApiError::ffmpeg(
            "Could not read a subtitle track for the selected segment.",
        ));
    }
    Ok(())
}

pub(crate) fn remux_prepared(job_id: &str, partial: &Path, mov_text: bool) -> ApiResult<()> {
    let segment = {
        let prepared = PREPARED.lock().unwrap_or_else(|error| error.into_inner());
        let Some((_, segment)) = prepared.iter().find(|(id, _)| id == job_id) else {
            return Ok(());
        };
        if !segment.remux_text_subtitles || segment.text_subtitle_files.is_empty() {
            return Ok(());
        }
        PreparedSegment {
            output_start: segment.output_start,
            output_end: segment.output_end,
            directory: segment.directory.clone(),
            chapter_file: segment.chapter_file.clone(),
            text_subtitle_files: segment.text_subtitle_files.clone(),
            image_subtitle_count: segment.image_subtitle_count,
            remux_text_subtitles: segment.remux_text_subtitles,
        }
    };
    remux_text_subtitles(partial, &segment, mov_text)
}

pub(crate) fn remux_text_subtitles(
    partial: &Path,
    segment: &PreparedSegment,
    mov_text: bool,
) -> ApiResult<()> {
    let text_subtitles = &segment.text_subtitle_files;
    let chapter_file = segment.chapter_file.as_deref();
    let image_count = segment.image_subtitle_count;
    if text_subtitles.is_empty() {
        return Ok(());
    }
    let remuxed = partial.with_extension("remux");
    let mut command = Command::new(sidecar_path("ffmpeg")?);
    command
        .args(["-hide_banner", "-nostdin", "-y", "-i"])
        .arg(partial);
    for subtitle in text_subtitles {
        command.arg("-i").arg(subtitle);
    }
    if let Some(chapters) = chapter_file {
        command.arg("-i").arg(chapters);
    }
    command.args(["-map", "0:v?", "-map", "0:a?", "-map", "0:s?"]);
    for index in 1..=text_subtitles.len() {
        command.args(["-map", &format!("{index}:0")]);
    }
    if chapter_file.is_some() {
        let chapter_index = 1 + text_subtitles.len();
        command.args(["-map_chapters", &chapter_index.to_string()]);
    } else {
        command.args(["-map_chapters", "0"]);
    }
    let text_codec = if mov_text { "mov_text" } else { "srt" };
    command.args(["-c", "copy"]);
    if image_count == 0 {
        command.arg("-c:s").arg(text_codec);
    } else {
        for index in 0..image_count {
            command.arg(format!("-c:s:{index}")).arg("copy");
        }
        for offset in 0..text_subtitles.len() {
            command
                .arg(format!("-c:s:{}", image_count + offset))
                .arg(text_codec);
        }
    }
    let status = command
        .arg(&remuxed)
        .output()
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?;
    if !status.status.success() {
        let _ = fs::remove_file(&remuxed);
        return Err(ApiError::ffmpeg(
            "Could not add the trimmed subtitles to the converted video.",
        ));
    }
    replace_file_keep_inode(partial, &remuxed).map_err(|error| {
        ApiError::ffmpeg(format!(
            "Could not add the trimmed subtitles to the converted video: {error}"
        ))
    })?;
    let _ = fs::remove_file(remuxed);
    Ok(())
}

fn replace_file_keep_inode(target: &Path, source: &Path) -> std::io::Result<()> {
    let bytes = fs::read(source)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(target)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

fn selected_image_subtitles(job: &PendingJob) -> Vec<&super::SubtitleStream> {
    if !job.request.preserve_subtitles || job.request.container != super::OutputContainer::Mkv {
        return Vec::new();
    }
    job.request
        .subtitle_stream_indexes
        .iter()
        .filter_map(|index| {
            job.media
                .subtitles
                .iter()
                .find(|stream| stream.index == *index && !is_text_subtitle(&stream.codec))
        })
        .collect()
}

fn selected_text_subtitles(job: &PendingJob) -> Vec<&super::SubtitleStream> {
    if !job.request.preserve_subtitles {
        return Vec::new();
    }
    job.request
        .subtitle_stream_indexes
        .iter()
        .filter_map(|index| {
            job.media
                .subtitles
                .iter()
                .find(|stream| stream.index == *index && is_text_subtitle(&stream.codec))
        })
        .collect()
}

fn write_file(path: &Path, contents: &str) -> ApiResult<PathBuf> {
    fs::write(path, contents).map_err(|error| {
        ApiError::ffmpeg(format!("Could not prepare the segment files: {error}"))
    })?;
    Ok(path.to_path_buf())
}

fn run_sidecar(binary: &str, arguments: &[&str], input: &Path) -> ApiResult<String> {
    let output = Command::new(sidecar_path(binary)?)
        .args(arguments)
        .arg(input)
        .output()
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?;
    if !output.status.success() {
        return Err(ApiError::ffmpeg(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn sidecar_path(binary: &str) -> ApiResult<PathBuf> {
    let name = format!("{binary}-{}", host_target_triple());
    let candidates = [
        std::env::current_exe()
            .ok()
            .and_then(|executable| executable.parent().map(|directory| directory.join(&name))),
        Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(&name),
        ),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .ok_or_else(|| ApiError::ffmpeg(format!("The {binary} tool is not available.")))
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn escape_metadata(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '=' | ';' | '#' | '\\' | '\n' | '\r' => vec!['\\', character],
            _ => vec![character],
        })
        .collect()
}

fn parse_srt_range(line: &str) -> Option<(f64, f64)> {
    let (start, end) = line.split_once("-->")?;
    Some((parse_srt_time(start)?, parse_srt_time(end)?))
}

fn parse_srt_time(value: &str) -> Option<f64> {
    let value = value.trim().replace(',', ".");
    let (clock, fraction) = value.split_once('.').unwrap_or((value.as_str(), "0"));
    let mut parts = clock.split(':').map(|part| part.parse::<f64>().ok());
    let (hours, minutes, seconds) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(Some(hours)), Some(Some(minutes)), Some(Some(seconds)), None) => {
            (hours, minutes, seconds)
        }
        (Some(Some(minutes)), Some(Some(seconds)), None, None) => (0.0, minutes, seconds),
        (Some(Some(seconds)), None, None, None) => (0.0, 0.0, seconds),
        _ => return None,
    };
    let millis = fraction
        .chars()
        .take(3)
        .collect::<String>()
        .parse::<f64>()
        .ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds + millis / 1000.0)
}

fn format_srt_time(seconds: f64) -> String {
    let total = (seconds.max(0.0) * 1000.0).round() as u64;
    let millis = total % 1000;
    let total_seconds = total / 1000;
    let seconds = total_seconds % 60;
    let minutes = (total_seconds / 60) % 60;
    let hours = total_seconds / 3600;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

#[cfg(test)]
mod tests {
    use super::{
        chapter_metadata, clip_cues, keyframe_at_or_before, output_start_seconds,
        parse_keyframe_times, parse_srt, watched_duration, write_srt, Cue,
    };
    use crate::ffmpeg::{ChapterMark, SegmentTrim};

    fn trim(start: f64, end: f64) -> Option<SegmentTrim> {
        Some(SegmentTrim {
            start_seconds: start,
            end_seconds: end,
        })
    }

    #[test]
    fn original_video_starts_on_the_previous_keyframe() {
        let times = parse_keyframe_times("0.000000,\n5.000000\n10.000000\n15.000000\n");
        assert_eq!(keyframe_at_or_before(&times, 7.3), Some(5.0));
        assert_eq!(
            output_start_seconds(trim(7.3, 12.8), 20.0, true, Some(5.0)),
            Some(5.0)
        );
        assert!((watched_duration(trim(7.3, 12.8), 20.0, Some(5.0)) - 7.8).abs() < 0.001);
        assert_eq!(
            output_start_seconds(trim(7.3, 12.8), 20.0, false, Some(5.0)),
            Some(7.3)
        );
        assert!((watched_duration(trim(7.3, 12.8), 20.0, Some(7.3)) - 5.5).abs() < 0.001);
    }

    #[test]
    fn cues_and_chapters_are_clipped_to_the_output_timeline() {
        let cues = [
            Cue {
                start: 1.0,
                end: 3.0,
                body: "one".to_owned(),
            },
            Cue {
                start: 6.0,
                end: 9.0,
                body: "two".to_owned(),
            },
            Cue {
                start: 12.0,
                end: 14.0,
                body: "three".to_owned(),
            },
        ];
        let clipped = clip_cues(&cues, 7.3, 12.8);
        assert_eq!(clipped.len(), 2);
        assert_eq!(clipped[0].body, "two");
        assert!((clipped[0].start - 0.0).abs() < 0.001);
        assert!((clipped[0].end - 1.7).abs() < 0.001);
        assert_eq!(clipped[1].body, "three");
        assert!((clipped[1].start - 4.7).abs() < 0.001);
        assert!((clipped[1].end - 5.5).abs() < 0.001);

        let copy_timeline = clip_cues(&cues, 5.0, 12.8);
        assert_eq!(copy_timeline[0].body, "two");
        assert!((copy_timeline[0].start - 1.0).abs() < 0.001);
        assert!((copy_timeline[0].end - 4.0).abs() < 0.001);
        assert!((copy_timeline[1].start - 7.0).abs() < 0.001);
        assert!((copy_timeline[1].end - 7.8).abs() < 0.001);

        let written = write_srt(&clipped);
        let parsed = parse_srt(&written);
        assert_eq!(parsed[0].body, "two");
        assert!((parsed[0].end - 1.7).abs() < 0.001);

        let chapters = [
            ChapterMark {
                start_seconds: 0.0,
                end_seconds: 5.0,
                title: Some("A".to_owned()),
            },
            ChapterMark {
                start_seconds: 5.0,
                end_seconds: 12.0,
                title: Some("B".to_owned()),
            },
            ChapterMark {
                start_seconds: 12.0,
                end_seconds: 20.0,
                title: Some("C".to_owned()),
            },
        ];
        let metadata = chapter_metadata(&chapters, 5.0, 12.8).unwrap();
        assert!(metadata.contains("START=0\nEND=7000"));
        assert!(metadata.contains("title=B"));
        assert!(metadata.contains("START=7000\nEND=7800"));
        assert!(metadata.contains("title=C"));
        assert!(!metadata.contains("title=A"));
    }
}
