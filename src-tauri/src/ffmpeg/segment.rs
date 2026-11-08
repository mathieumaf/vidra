//! Timeline adjustments for a trimmed conversion.
//!
//! Original video starts on the previous keyframe, while a re-encode starts on
//! the requested frame. Chapters and text subtitles are rewritten onto that
//! output timeline and clipped so they cannot extend the file.

use super::{
    trim::{self, format_timestamp},
    SegmentTrim, VideoCodec,
};
use crate::{
    error::{ApiError, ApiResult},
    jobs::{process::RunningProcess, JobManager, PendingJob, PreparedSegment},
    output::partial::{self, PartialCleanup, PartialLedger, PartialOutput},
};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const MILLISECOND: f64 = 0.001;
/// First probe window. A later start only reads this far back, then wider
/// windows if that range has no keyframe.
const KEYFRAME_LOOKBACKS: [f64; 3] = [30.0, 120.0, 600.0];
/// Cues are packets at their start time. Reading this far before the clip
/// keeps a cue that is already on screen without scanning the whole file.
const SUBTITLE_LOOKBACK_SECONDS: f64 = 300.0;

pub(crate) const COPY_START_UNAVAILABLE: &str = "Vidra could not find where Original video will start, so this conversion was not started. Change the start time to try again, or choose a format that re-encodes the video.";

pub(crate) struct SegmentInputs {
    pub extra: Vec<PathBuf>,
    pub chapter_index: Option<usize>,
    pub text_indexes: Vec<(u32, usize)>,
    pub replace_text: bool,
    pub copy_source_subtitles: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cue {
    pub start: f64,
    pub end: f64,
    pub body: String,
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

pub(crate) async fn prepare(
    app: &AppHandle,
    job: &PendingJob,
) -> ApiResult<Option<PreparedSegment>> {
    let Some(segment) = trim::normalize_trim(job.request.trim, job.media.duration_seconds)? else {
        return Ok(None);
    };
    let jobs = app.state::<JobManager>();
    jobs.begin_preparation(&job.id)?;
    let guard = PreparationGuard {
        jobs,
        job_id: job.id.clone(),
    };
    let prepared = prepare_segment(app, job, segment).await;
    drop(guard);
    prepared
}

async fn prepare_segment(
    app: &AppHandle,
    job: &PendingJob,
    segment: SegmentTrim,
) -> ApiResult<Option<PreparedSegment>> {
    let copy_video = job.request.video_codec == VideoCodec::Copy;
    let keyframe = if copy_video {
        Some(
            read_keyframe(
                app,
                Some(&job.id),
                &super::paths::validate_input(&job.request.input_path)?,
                segment.start_seconds,
            )
            .await?,
        )
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
    let directory = create_segment_directory(&job.id)?;
    let prepared = prepare_files(app, job, &directory, output_start, output_end, copy_video).await;
    if prepared.is_err() {
        let _ = fs::remove_dir_all(&directory);
    }
    prepared
}

async fn prepare_files(
    app: &AppHandle,
    job: &PendingJob,
    directory: &Path,
    output_start: f64,
    output_end: f64,
    copy_video: bool,
) -> ApiResult<Option<PreparedSegment>> {
    let chapter_file = if job.request.preserve_chapters {
        chapter_metadata(&job.media.chapters, output_start, output_end)
            .map(|metadata| write_file(&directory.join("chapters.txt"), &metadata))
            .transpose()?
    } else {
        None
    };

    let image_subtitle_count = selected_image_subtitles(job).len();
    let mut text_subtitle_files = Vec::new();
    let mut text_subtitle_indexes = Vec::new();
    for subtitle in selected_text_subtitles(job) {
        if app.state::<JobManager>().is_cancelled(&job.id) {
            return Err(cancelled());
        }
        let extracted = directory.join(format!("source-{}.srt", subtitle.index));
        let offset = extract_srt(
            app,
            &job.id,
            &job.request.input_path,
            subtitle.index,
            &extracted,
            output_start,
            output_end,
        )
        .await?;
        let cues = clip_cues(
            &shift_cues(
                &parse_srt(&fs::read_to_string(&extracted).unwrap_or_default()),
                offset,
            ),
            output_start,
            output_end,
        );
        if cues.is_empty() {
            continue;
        }
        let clipped = directory.join(format!("clipped-{}.srt", subtitle.index));
        write_file(&clipped, &write_srt(&cues))?;
        text_subtitle_files.push(clipped);
        text_subtitle_indexes.push(subtitle.index);
    }

    Ok(Some(PreparedSegment {
        output_start,
        output_end,
        directory: directory.to_path_buf(),
        chapter_file,
        text_subtitle_files,
        text_subtitle_indexes,
        subtitles: job
            .request
            .subtitle_stream_indexes
            .iter()
            .filter_map(|index| {
                job.media
                    .subtitles
                    .iter()
                    .find(|stream| stream.index == *index)
            })
            .filter(|stream| {
                job.request.preserve_subtitles
                    && (job.request.container == super::OutputContainer::Mkv
                        || is_text_subtitle(&stream.codec))
            })
            .cloned()
            .collect(),
        image_subtitle_count,
        remux_text_subtitles: copy_video,
    }))
}

pub(crate) fn segment_inputs(segment: &PreparedSegment) -> SegmentInputs {
    let extra = extra_inputs(segment);
    let text_indexes = text_input_indexes(segment);
    let chapter_index = chapter_input_index(segment);
    SegmentInputs {
        replace_text: true,
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

pub(crate) fn text_input_indexes(segment: &PreparedSegment) -> Vec<(u32, usize)> {
    if segment.remux_text_subtitles {
        Vec::new()
    } else {
        segment
            .text_subtitle_indexes
            .iter()
            .copied()
            .zip(1..)
            .collect()
    }
}

pub(crate) async fn keyframe_before(
    app: &AppHandle,
    path: &str,
    start_seconds: f64,
) -> ApiResult<f64> {
    let input = super::paths::validate_input(path)?;
    read_keyframe(app, None, &input, start_seconds).await
}

/// `START%END` reads only that interval. The end is the chosen start, and the
/// beginning is a bounded lookback so a late start does not scan the file.
pub(crate) fn keyframe_read_interval(start_seconds: f64, lookback_seconds: f64) -> String {
    let start = start_seconds.max(0.0);
    let from = (start - lookback_seconds.max(0.0)).max(0.0);
    format!("{}%{}", format_timestamp(from), format_timestamp(start))
}

async fn read_keyframe(
    app: &AppHandle,
    job_id: Option<&str>,
    input: &Path,
    start_seconds: f64,
) -> ApiResult<f64> {
    let start = start_seconds.max(0.0);
    for lookback in KEYFRAME_LOOKBACKS {
        let interval = keyframe_read_interval(start, lookback);
        let output = match run_sidecar(
            app,
            job_id,
            "ffprobe",
            vec![
                os("-v"),
                os("error"),
                os("-select_streams"),
                os("v:0"),
                os("-skip_frame"),
                os("nokey"),
                os("-read_intervals"),
                os(&interval),
                os("-show_entries"),
                os("frame=pts_time"),
                os("-of"),
                os("csv=p=0"),
                input.as_os_str().to_os_string(),
            ],
        )
        .await
        {
            Ok(output) => output,
            Err(error) => return Err(keyframe_error(error)),
        };
        if !output.success {
            let detail = output.stderr.trim();
            return Err(keyframe_error(ApiError::ffmpeg(if detail.is_empty() {
                COPY_START_UNAVAILABLE.to_owned()
            } else {
                detail.to_owned()
            })));
        }
        if let Some(time) = keyframe_at_or_before(&parse_keyframe_times(&output.stdout), start) {
            return Ok(time);
        }
        if start <= lookback + MILLISECOND {
            return Ok(0.0);
        }
    }
    Ok(0.0)
}

/// Extracts one subtitle track around the clip and returns the source time
/// where the extracted file starts. Input seeking moves cue times so that this
/// time becomes zero.
async fn extract_srt(
    app: &AppHandle,
    job_id: &str,
    source: &str,
    index: u32,
    destination: &Path,
    window_start: f64,
    window_end: f64,
) -> ApiResult<f64> {
    let source = super::paths::validate_input(source)?;
    let from = subtitle_window_start(window_start);
    let output = run_sidecar(
        app,
        Some(job_id),
        "ffmpeg",
        extract_srt_arguments(&source, index, destination, from, window_end),
    )
    .await?;
    if !output.success {
        return Err(ApiError::ffmpeg(
            "Could not read a subtitle track for the selected segment.",
        ));
    }
    Ok(from)
}

fn subtitle_window_start(window_start: f64) -> f64 {
    (window_start - SUBTITLE_LOOKBACK_SECONDS).max(0.0)
}

fn extract_srt_arguments(
    source: &Path,
    index: u32,
    destination: &Path,
    from: f64,
    to: f64,
) -> Vec<std::ffi::OsString> {
    vec![
        os("-hide_banner"),
        os("-nostdin"),
        os("-y"),
        os("-ss"),
        os(&format_timestamp(from)),
        os("-to"),
        os(&format_timestamp(to)),
        os("-i"),
        source.as_os_str().to_os_string(),
        os("-map"),
        os(&format!("0:{index}")),
        os("-vn"),
        os("-an"),
        os("-f"),
        os("srt"),
        destination.as_os_str().to_os_string(),
    ]
}

/// Moves extracted cues back onto the source timeline.
pub(crate) fn shift_cues(cues: &[Cue], offset: f64) -> Vec<Cue> {
    cues.iter()
        .map(|cue| Cue {
            start: cue.start + offset,
            end: cue.end + offset,
            body: cue.body.clone(),
        })
        .collect()
}

pub(crate) struct SubtitleRemux {
    pub command: String,
    pub error: Option<ApiError>,
}

pub(crate) async fn remux_text_subtitles(
    app: &AppHandle,
    job_id: &str,
    partial: &PartialOutput,
    segment: &PreparedSegment,
    mov_text: bool,
) -> ApiResult<Option<SubtitleRemux>> {
    if segment.text_subtitle_files.is_empty() {
        return Ok(None);
    }
    // The encoder has exited, so the remux runs as a preparation step. This
    // lets the job accept its process and lets Cancel stop it.
    let jobs = app.state::<JobManager>();
    jobs.begin_preparation(job_id)?;
    let _guard = PreparationGuard {
        jobs: app.state::<JobManager>(),
        job_id: job_id.to_owned(),
    };
    let auxiliary = partial::create_partial(
        &partial.path,
        &format!("{job_id}-remux"),
        if mov_text { "mp4" } else { "mkv" },
        &jobs.reserved_output_paths()?,
        &jobs.input_paths()?,
    )?;
    let ledger = app.state::<PartialLedger>();
    let auxiliary_guard = AuxiliaryPartialGuard {
        jobs,
        ledger,
        partial: auxiliary,
        job_id: job_id.to_owned(),
    };
    auxiliary_guard.ledger.record(&auxiliary_guard.partial)?;
    auxiliary_guard
        .jobs
        .set_auxiliary_partial(job_id, auxiliary_guard.partial.clone())?;
    let plan = remux_plan(
        &partial.path,
        segment,
        mov_text,
        &auxiliary_guard.partial.path,
    )
    .expect("a clipped subtitle has a remux plan");
    let output = match run_sidecar(app, Some(job_id), "ffmpeg", plan.arguments).await {
        Ok(output) => output,
        Err(error) => {
            return Ok(Some(SubtitleRemux {
                command: plan.command,
                error: Some(error),
            }));
        }
    };
    if !output.success {
        return Ok(Some(SubtitleRemux {
            command: plan.command,
            error: Some(ApiError::ffmpeg(
                "Could not add the trimmed subtitles to the converted video.",
            )),
        }));
    }
    if let Err(error) = partial::replace_contents(partial, &auxiliary_guard.partial) {
        return Ok(Some(SubtitleRemux {
            command: plan.command,
            error: Some(ApiError::ffmpeg(format!(
                "Could not add the trimmed subtitles to the converted video: {error}"
            ))),
        }));
    }
    Ok(Some(SubtitleRemux {
        command: plan.command,
        error: None,
    }))
}

struct RemuxPlan {
    arguments: Vec<std::ffi::OsString>,
    command: String,
}

fn remux_plan(
    partial: &Path,
    segment: &PreparedSegment,
    mov_text: bool,
    output: &Path,
) -> Option<RemuxPlan> {
    let text_subtitles = &segment.text_subtitle_files;
    if text_subtitles.is_empty() {
        return None;
    }
    let output = output.to_path_buf();
    let format = if mov_text { "mp4" } else { "matroska" };
    let mut arguments = Vec::new();
    arguments.extend(["-hide_banner", "-nostdin", "-y", "-i"].map(os));
    arguments.push(partial.as_os_str().to_os_string());
    for subtitle in text_subtitles {
        arguments.push(os("-i"));
        arguments.push(subtitle.as_os_str().to_os_string());
    }
    if let Some(chapters) = &segment.chapter_file {
        arguments.push(os("-i"));
        arguments.push(chapters.as_os_str().to_os_string());
    }
    arguments.extend(["-map", "0:v?", "-map", "0:a?", "-c", "copy"].map(os));
    let mut image_index = 0;
    let mut output_index = 0;
    for stream in &segment.subtitles {
        let input = if is_text_subtitle(&stream.codec) {
            let Some(index) = segment
                .text_subtitle_indexes
                .iter()
                .position(|index| *index == stream.index)
            else {
                continue;
            };
            format!("{}:0", index + 1)
        } else {
            let input = format!("0:s:{image_index}");
            image_index += 1;
            input
        };
        arguments.extend([os("-map"), os(&input)]);
        let codec = if !is_text_subtitle(&stream.codec) {
            "copy"
        } else if mov_text {
            "mov_text"
        } else {
            "srt"
        };
        arguments.extend([os(&format!("-c:s:{output_index}")), os(codec)]);
        arguments.extend(
            subtitle_metadata_arguments(stream, output_index, mov_text)
                .iter()
                .map(|arg| os(arg)),
        );
        output_index += 1;
    }
    if segment.chapter_file.is_some() {
        let chapter_index = 1 + text_subtitles.len();
        arguments.push(os("-map_chapters"));
        arguments.push(os(&chapter_index.to_string()));
    } else {
        arguments.extend(["-map_chapters", "0"].map(os));
    }
    if mov_text {
        arguments.extend(["-movflags", "+faststart"].map(os));
    }
    arguments.push(os("-f"));
    arguments.push(os(format));
    arguments.push(output.as_os_str().to_os_string());
    let command = redacted_remux_command(&arguments, partial, &output);
    Some(RemuxPlan { arguments, command })
}

pub(crate) fn subtitle_metadata_arguments(
    stream: &super::SubtitleStream,
    output: usize,
    mov_text: bool,
) -> Vec<String> {
    let mut arguments = Vec::new();
    for (key, value) in [("language", &stream.language), ("title", &stream.title)] {
        if let Some(value) = value {
            arguments.extend([format!("-metadata:s:s:{output}"), format!("{key}={value}")]);
        }
    }
    // MP4 exposes the track name as handler_name rather than Matroska's title.
    if mov_text {
        if let Some(title) = &stream.title {
            arguments.extend([
                format!("-metadata:s:s:{output}"),
                format!("handler_name={title}"),
            ]);
        }
    }
    let disposition = match (stream.is_default, stream.is_forced) {
        (true, true) => "default+forced",
        (true, false) => "default",
        (false, true) => "forced",
        (false, false) => "0",
    };
    arguments.extend([format!("-disposition:s:{output}"), disposition.to_owned()]);
    arguments
}

struct AuxiliaryPartialGuard<'a> {
    jobs: tauri::State<'a, JobManager>,
    ledger: tauri::State<'a, PartialLedger>,
    partial: PartialOutput,
    job_id: String,
}

impl Drop for AuxiliaryPartialGuard<'_> {
    fn drop(&mut self) {
        if partial::discard_partial(&self.partial) == PartialCleanup::Resolved {
            let _ = self.ledger.forget(&self.partial);
        }
        let _ = self.jobs.clear_auxiliary_partial(&self.job_id);
    }
}

fn redacted_remux_command(
    arguments: &[std::ffi::OsString],
    partial: &Path,
    output: &Path,
) -> String {
    let mut parts = vec!["ffmpeg".to_owned()];
    for argument in arguments {
        if argument.as_os_str() == partial.as_os_str() || argument.as_os_str() == output.as_os_str()
        {
            parts.push("<output>".to_owned());
        } else {
            parts.push(argument.to_string_lossy().into_owned());
        }
    }
    parts.join(" ")
}

struct ToolOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

async fn run_sidecar(
    app: &AppHandle,
    job_id: Option<&str>,
    binary: &str,
    arguments: Vec<std::ffi::OsString>,
) -> ApiResult<ToolOutput> {
    let command = app
        .shell()
        .sidecar(binary)
        .map_err(|_| ApiError::ffmpeg(format!("The {binary} tool is not available.")))?
        .args(arguments)
        .kill_on_drop(true);
    if job_id.is_none() {
        let output = command
            .output()
            .await
            .map_err(|error| ApiError::ffmpeg(error.to_string()))?;
        return Ok(ToolOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        });
    }
    let job_id = job_id.expect("a preparation job id");
    let (mut receiver, child) = command
        .spawn()
        .map_err(|error| ApiError::ffmpeg(error.to_string()))?;
    app.state::<JobManager>()
        .attach_preparing(job_id, RunningProcess::from_shell(child))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut code = None;
    while let Some(event) = receiver.recv().await {
        match event {
            CommandEvent::Stdout(line) => push_line(&mut stdout, &line),
            CommandEvent::Stderr(line) => push_line(&mut stderr, &line),
            CommandEvent::Terminated(payload) => code = payload.code,
            CommandEvent::Error(_) => {}
            _ => {}
        }
    }
    let _ = app.state::<JobManager>().take_preparing_process(job_id);
    if app.state::<JobManager>().is_cancelled(job_id) {
        return Err(cancelled());
    }
    Ok(ToolOutput {
        success: code == Some(0),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

fn push_line(buffer: &mut Vec<u8>, line: &[u8]) {
    buffer.extend_from_slice(line);
    if !buffer.ends_with(b"\n") {
        buffer.push(b'\n');
    }
}

fn os(value: &str) -> std::ffi::OsString {
    std::ffi::OsString::from(value)
}

fn cancelled() -> ApiError {
    ApiError::new("cancelled", "The conversion was cancelled.")
}

fn keyframe_error(error: ApiError) -> ApiError {
    if error.code == "cancelled" || error.message.contains("not available") {
        error
    } else {
        ApiError::ffmpeg(COPY_START_UNAVAILABLE)
    }
}

struct PreparationGuard<'a> {
    jobs: tauri::State<'a, JobManager>,
    job_id: String,
}

impl Drop for PreparationGuard<'_> {
    fn drop(&mut self) {
        self.jobs.end_preparation(&self.job_id);
    }
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

fn create_segment_directory(job_id: &str) -> ApiResult<PathBuf> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);
    let job_id: String = job_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect();
    // create_dir is exclusive: even a stale directory from a reused PID is
    // never adopted or removed by a different conversion.
    for _ in 0..32 {
        let nonce = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "vidra-segment-{}-{job_id}-{nonce}",
            std::process::id()
        ));
        match fs::create_dir(&directory) {
            Ok(()) => return Ok(directory),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(ApiError::ffmpeg(format!(
                    "Could not prepare the segment files: {error}"
                )))
            }
        }
    }
    Err(ApiError::ffmpeg(
        "Could not create a separate folder for the segment files.",
    ))
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
    use std::{fs, path::PathBuf};

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

    #[test]
    fn keyframe_probe_reads_a_bounded_window_before_the_start() {
        assert_eq!(super::keyframe_read_interval(7.3, 30.0), "0%7.3");
        assert_eq!(super::keyframe_read_interval(90.0, 30.0), "60%90");
        assert_eq!(super::keyframe_read_interval(0.0, 30.0), "0%0");
    }

    #[test]
    fn segment_directories_are_exclusive_even_for_the_same_job() {
        let first = super::create_segment_directory("job-1").unwrap();
        fs::write(first.join("keep"), "first job").unwrap();
        let second = super::create_segment_directory("job-1").unwrap();
        assert_ne!(first, second);
        fs::remove_dir_all(second).unwrap();
        assert_eq!(fs::read_to_string(first.join("keep")).unwrap(), "first job");
        fs::remove_dir_all(first).unwrap();
    }

    #[test]
    fn remux_preserves_subtitle_order_and_mp4_fast_start() {
        use std::path::Path;
        let partial = Path::new("/tmp/.vidra-partial-t.mkv");
        let output = Path::new("/tmp/.vidra-partial-remux-abc123.mkv");
        let mut segment = subtitle_segment(Path::new("/tmp/vidra-segment/clipped.srt"));
        let mut image = segment.subtitles[0].clone();
        image.index = 4;
        image.codec = "hdmv_pgs_subtitle".to_owned();
        image.is_forced = false;
        segment.subtitles.push(image);
        segment.image_subtitle_count = 1;
        let plan = super::remux_plan(partial, &segment, false, output).unwrap();
        let arguments = plan
            .arguments
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let maps = arguments
            .windows(2)
            .filter(|pair| pair[0] == "-map")
            .map(|pair| pair[1].as_str())
            .collect::<Vec<_>>();
        assert_eq!(maps, ["0:v?", "0:a?", "1:0", "0:s:0"]);
        assert!(arguments.windows(2).any(|pair| pair == ["-c:s:0", "srt"]));
        assert!(arguments.windows(2).any(|pair| pair == ["-c:s:1", "copy"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-disposition:s:0", "forced"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-disposition:s:1", "0"]));
        assert!(plan.command.contains("<output>"));
        assert!(!plan.command.contains(partial.to_str().unwrap()));
        assert!(!plan.command.contains(output.to_str().unwrap()));
        segment.subtitles.pop();
        segment.image_subtitle_count = 0;
        let mp4 = super::remux_plan(
            partial,
            &segment,
            true,
            Path::new("/tmp/.vidra-partial-remux-abc123.mp4"),
        )
        .unwrap();
        let mp4_arguments = mp4
            .arguments
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(mp4_arguments.windows(2).any(|pair| pair == ["-f", "mp4"]));
        assert!(mp4_arguments
            .windows(2)
            .any(|pair| pair == ["-movflags", "+faststart"]));
    }

    #[test]
    fn remux_text_subtitles_with_ffmpeg() {
        use std::{fs, process::Command};

        let Some(ffmpeg) = prepared_binary("ffmpeg") else {
            if std::env::var("VIDRA_CORPUS_REQUIRED").ok().as_deref() == Some("1") {
                panic!("FFmpeg is required to remux trimmed subtitles");
            }
            eprintln!("skipping subtitle remux: prepared FFmpeg sidecar is missing");
            return;
        };
        let Some(ffprobe) = prepared_binary("ffprobe") else {
            if std::env::var("VIDRA_CORPUS_REQUIRED").ok().as_deref() == Some("1") {
                panic!("FFprobe is required to check a remuxed subtitle");
            }
            eprintln!("skipping subtitle remux: prepared FFprobe sidecar is missing");
            return;
        };

        let directory = std::env::temp_dir().join(format!(
            "vidra-remux-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&directory).expect("remux directory");
        let source = directory.join("source.mkv");
        let generated = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=64x64:rate=10:duration=1",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=mono:sample_rate=44100",
                "-t",
                "1",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&source)
            .output()
            .expect("ffmpeg should run");
        assert!(
            generated.status.success(),
            "could not prepare a subtitle remux source\n{}",
            String::from_utf8_lossy(&generated.stderr)
        );

        let subtitle = directory.join("clipped.srt");
        fs::write(&subtitle, "1\n00:00:00,000 --> 00:00:00,400\nhello\n").expect("subtitle");
        let mut segment = subtitle_segment(&subtitle);
        let mut french = segment.subtitles[0].clone();
        french.index = 4;
        french.language = Some("fra".to_owned());
        french.title = Some("French".to_owned());
        french.is_default = true;
        french.is_forced = false;
        segment.subtitles.push(french);
        segment.text_subtitle_indexes.push(4);
        segment.text_subtitle_files.push(subtitle);
        for (extension, mov_text) in [("mkv", false), ("mp4", true)] {
            let partial =
                super::partial::create_partial(&source, "video", extension, &[], &[]).unwrap();
            fs::copy(&source, &partial.path).expect("partial copy");
            let auxiliary =
                super::partial::create_partial(&source, "remux", extension, &[], &[]).unwrap();
            let plan =
                super::remux_plan(&partial.path, &segment, mov_text, &auxiliary.path).unwrap();
            let remuxed = Command::new(&ffmpeg)
                .args(&plan.arguments)
                .output()
                .expect("ffmpeg remux");
            assert!(
                remuxed.status.success(),
                "FFmpeg remux failed: {}",
                String::from_utf8_lossy(&remuxed.stderr)
            );
            super::partial::replace_contents(&partial, &auxiliary).unwrap();
            super::partial::discard_partial(&auxiliary);
            assert!(!auxiliary.path.exists());
            let probed = Command::new(&ffprobe)
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "s",
                    "-show_streams",
                    "-of",
                    "json",
                ])
                .arg(&partial.path)
                .output()
                .expect("ffprobe");
            assert!(probed.status.success());
            let json: serde_json::Value = serde_json::from_slice(&probed.stdout).unwrap();
            let streams = json["streams"].as_array().unwrap();
            assert_eq!(streams.len(), 2);
            assert_eq!(streams[0]["tags"]["language"], "eng");
            assert_eq!(streams[1]["tags"]["language"], "fra");
            assert_eq!(streams[0]["disposition"]["forced"], 1);
            assert_eq!(streams[0]["disposition"]["default"], 0);
            assert_eq!(streams[1]["disposition"]["default"], 1);
            assert_eq!(streams[1]["disposition"]["forced"], 0);
            if !mov_text {
                assert_eq!(streams[0]["tags"]["title"], "English forced");
                assert_eq!(streams[1]["tags"]["title"], "French");
            } else {
                assert_eq!(streams[0]["tags"]["handler_name"], "English forced");
                assert_eq!(streams[1]["tags"]["handler_name"], "French");
                let bytes = fs::read(&partial.path).unwrap();
                let moov = bytes.windows(4).position(|word| word == b"moov").unwrap();
                let mdat = bytes.windows(4).position(|word| word == b"mdat").unwrap();
                assert!(moov < mdat, "MP4 must retain fast start after remux");
            }
            super::partial::discard_partial(&partial);
        }
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn extracted_cues_return_to_the_source_timeline() {
        assert_eq!(super::subtitle_window_start(42.0), 0.0);
        assert_eq!(super::subtitle_window_start(402.0), 102.0);
        let cues = vec![Cue {
            start: 299.0,
            end: 302.0,
            body: "late".to_owned(),
        }];
        let shifted = super::shift_cues(&cues, 102.0);
        assert!((shifted[0].start - 401.0).abs() < 0.001);
        assert!((shifted[0].end - 404.0).abs() < 0.001);
        assert_eq!(shifted[0].body, "late");
    }

    #[test]
    fn late_subtitles_are_extracted_on_the_source_timeline_with_ffmpeg() {
        use std::{fs, process::Command};

        let Some(ffmpeg) = prepared_binary("ffmpeg") else {
            if std::env::var("VIDRA_CORPUS_REQUIRED").ok().as_deref() == Some("1") {
                panic!("FFmpeg is required to extract late subtitles");
            }
            eprintln!("skipping late subtitles: prepared FFmpeg sidecar is missing");
            return;
        };

        let directory = std::env::temp_dir().join(format!(
            "vidra-late-subtitles-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&directory).expect("subtitle directory");
        let cues = directory.join("cues.srt");
        fs::write(
            &cues,
            "1\n00:06:35,000 --> 00:06:38,000\nbefore\n\n\
             2\n00:06:41,000 --> 00:06:44,000\nopening\n\n\
             3\n00:06:52,000 --> 00:06:56,000\nclosing\n",
        )
        .expect("cues");
        let source = directory.join("source.mkv");
        let generated = Command::new(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&cues)
            .args(["-c:s", "srt"])
            .arg(&source)
            .output()
            .expect("ffmpeg should run");
        assert!(
            generated.status.success(),
            "could not prepare a late subtitle source\n{}",
            String::from_utf8_lossy(&generated.stderr)
        );

        let (start, end) = (402.0, 414.0);
        let from = super::subtitle_window_start(start);
        let extracted = directory.join("extracted.srt");
        let output = Command::new(&ffmpeg)
            .args(super::extract_srt_arguments(
                &source, 0, &extracted, from, end,
            ))
            .output()
            .expect("ffmpeg extract");
        assert!(
            output.status.success(),
            "FFmpeg could not extract the subtitle window\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let text = fs::read_to_string(&extracted).expect("extracted subtitles");
        let clipped = clip_cues(&super::shift_cues(&parse_srt(&text), from), start, end);
        let _ = fs::remove_dir_all(&directory);

        assert_eq!(clipped.len(), 2, "unexpected cues: {clipped:?}");
        assert_eq!(clipped[0].body, "opening");
        assert!((clipped[0].start - 0.0).abs() < 0.001);
        assert!((clipped[0].end - 2.0).abs() < 0.001);
        assert_eq!(clipped[1].body, "closing");
        assert!((clipped[1].start - 10.0).abs() < 0.001);
        assert!((clipped[1].end - 12.0).abs() < 0.001);
    }

    fn subtitle_segment(subtitle: &std::path::Path) -> crate::jobs::PreparedSegment {
        crate::jobs::PreparedSegment {
            output_start: 0.0,
            output_end: 1.0,
            directory: subtitle
                .parent()
                .unwrap_or(std::path::Path::new("/tmp"))
                .to_path_buf(),
            chapter_file: None,
            text_subtitle_files: vec![subtitle.to_path_buf()],
            text_subtitle_indexes: vec![3],
            subtitles: vec![crate::ffmpeg::SubtitleStream {
                index: 3,
                codec: "subrip".to_owned(),
                language: Some("eng".to_owned()),
                title: Some("English forced".to_owned()),
                is_default: false,
                is_forced: true,
            }],
            image_subtitle_count: 0,
            remux_text_subtitles: true,
        }
    }

    fn prepared_binary(name: &str) -> Option<PathBuf> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "{name}-{}",
                super::super::version::host_target_triple()
            ));
        path.is_file().then_some(path)
    }
}
