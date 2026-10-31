//! End-to-end conversion of a synthetic corpus.
//!
//! Clips are generated with the sidecar FFmpeg and are not stored in git.
//! Each encode uses `encode::command_arguments` and the partial-file publish
//! path, then checks the result with `probe::probe_with_binary`.

use super::{
    encode::command_arguments,
    paths::{validate_input, validate_output, ExistingOutput},
    probe::probe_with_binary,
    progress::ProgressParser,
    AudioBitrate, AudioChannels, AudioMode, AudioTrackMode, EncodeRequest, EncodingSpeed,
    HdrFormat, MediaInfo, OutputContainer, OutputFrameRate, OutputResolution, QualityLevel,
    VideoCodec, VideoStream,
};
use crate::{
    error::ApiError,
    jobs::PendingJob,
    output::partial::{
        create_partial, discard_partial, finalize_output, FinalizeRequest, OutputOutcome,
        PartialCleanup,
    },
};
use serde::Deserialize;
use std::{
    collections::HashSet,
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Deserialize)]
struct Manifest {
    ffmpeg: String,
    ffprobe: String,
    #[serde(rename = "ffmpegVersion", default)]
    ffmpeg_version: String,
    clips: Vec<Clip>,
    unavailable: Vec<Unavailable>,
}

#[derive(Debug, Deserialize)]
struct Clip {
    id: String,
    path: String,
    role: String,
}

#[derive(Debug, Deserialize)]
struct Unavailable {
    id: String,
    reason: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Case {
    quality: QualityLevel,
    container: OutputContainer,
    codec: VideoCodec,
    speed: EncodingSpeed,
}

struct Capabilities {
    encoders: HashSet<String>,
    filters: HashSet<String>,
    encoder_help: Vec<(String, String)>,
}

struct Stats {
    encoded: u32,
    rejected: u32,
    skipped: Vec<String>,
    reported: Vec<String>,
    profiles: HashSet<&'static str>,
    qualities: Vec<QualityLevel>,
    codecs: Vec<VideoCodec>,
    containers: Vec<OutputContainer>,
}

#[test]
fn labels_ffmpeg_6_as_an_older_smoke_test() {
    assert_eq!(
        ffmpeg_major("ffmpeg version 6.1.1-3ubuntu5 Copyright"),
        Some(6)
    );
    assert_eq!(ffmpeg_major("ffmpeg version n8.1.3 Copyright"), Some(8));
    assert!(ffmpeg_major("ffmpeg version 6.1.1").is_some_and(|major| major < 7));
    assert!(ffmpeg_major("ffmpeg version 8.1.3").is_some_and(|major| major >= 7));
}

#[test]
fn sha256_matches_known_answers() {
    assert_eq!(
        hex(&sha256(b"")),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        hex(&sha256(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn reads_ffmpeg_capability_names() {
    let names = capability_names(
        "Encoders:\n V..... libx264              libx264 H.264\n A..... aac                  AAC\n",
    );
    assert!(names.contains("libx264"));
    assert!(names.contains("aac"));
    assert!(!names.contains("H.264"));

    let filters = capability_names(
        " T.. zscale            V->V       Apply resizing\n ... tonemap           V->V       Tone map\n TS zscale            V->V       Apply resizing\n .S tonemap           V->V       Tone map\n",
    );
    assert!(filters.contains("zscale"));
    assert!(filters.contains("tonemap"));
}

#[test]
fn reduced_matrix_covers_presets_profiles_codecs_and_containers() {
    let representative = cases_for("representative", false);
    for quality in qualities() {
        assert!(
            representative.contains(&Case {
                quality,
                container: OutputContainer::Mp4,
                codec: VideoCodec::H264,
                speed: EncodingSpeed::Efficient,
            }),
            "missing quality preset {quality:?}"
        );
    }
    for (quality, container, codec, speed) in [
        (
            QualityLevel::Balanced,
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
        ),
        (
            QualityLevel::SmallerFile,
            OutputContainer::Mp4,
            VideoCodec::H265,
            EncodingSpeed::Efficient,
        ),
        (
            QualityLevel::Balanced,
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Fast,
        ),
    ] {
        assert!(representative.contains(&Case {
            quality,
            container,
            codec,
            speed,
        }));
    }
    for codec in [
        VideoCodec::H264,
        VideoCodec::H265,
        VideoCodec::Av1,
        VideoCodec::Copy,
    ] {
        for container in [OutputContainer::Mp4, OutputContainer::Mkv] {
            assert!(
                representative.iter().any(|case| {
                    case.codec == codec
                        && case.container == container
                        && case.speed == EncodingSpeed::Efficient
                }),
                "missing {codec:?} {container:?}"
            );
        }
    }
    assert!(!representative
        .iter()
        .any(|case| { case.codec == VideoCodec::Av1 && case.speed == EncodingSpeed::Fast }));

    let hdr = cases_for("hdr10", false);
    assert_eq!(hdr.len(), 8);
    assert!(cases_for("corrupt", false).is_empty());
}

#[test]
#[ignore = "encodes the synthetic corpus with FFmpeg; see CONTRIBUTING.md"]
fn conversion_corpus() {
    let started = Instant::now();
    let full = full_matrix();
    let (manifest, _corpus_directory) = match prepare_corpus() {
        CorpusPrep::Skip(message) => {
            if corpus_required() {
                panic!("{message}");
            }
            eprintln!("{message}");
            return;
        }
        CorpusPrep::Ready(manifest, directory) => (manifest, directory),
    };

    for entry in &manifest.unavailable {
        eprintln!("{}: {}", entry.id, entry.reason);
    }

    let ffmpeg = PathBuf::from(&manifest.ffmpeg);
    let ffprobe = PathBuf::from(&manifest.ffprobe);
    let capabilities = Capabilities::load(&ffmpeg);
    if strict_encoders() {
        capabilities.require_strict();
    }

    let mut stats = Stats {
        encoded: 0,
        rejected: 0,
        skipped: Vec::new(),
        reported: Vec::new(),
        profiles: HashSet::new(),
        qualities: Vec::new(),
        codecs: Vec::new(),
        containers: Vec::new(),
    };
    let mut source_hashes = Vec::new();
    for clip in &manifest.clips {
        source_hashes.push((PathBuf::from(&clip.path), file_hash(Path::new(&clip.path))));
    }

    for clip in &manifest.clips {
        if clip.role == "corrupt" {
            expect_corrupt(&ffprobe, clip);
            stats.rejected += 1;
            assert_source_unchanged(&source_hashes);
            continue;
        }
        let probed = probe_with_binary(&ffprobe, &clip.path).unwrap_or_else(|error| {
            panic!("{}: FFprobe parsing failed: {}", clip.id, error.message);
        });
        for case in cases_for(&clip.role, full) {
            record_case(&mut stats, &case);
            run_case(
                CaseInput {
                    clip_id: &clip.id,
                    media: &probed.media,
                    source_side_data: &probed.video_side_data,
                    case,
                },
                &EncodeTools {
                    ffmpeg: &ffmpeg,
                    ffprobe: &ffprobe,
                    capabilities: &capabilities,
                },
                &mut stats,
            );
            assert_source_unchanged(&source_hashes);
        }
    }

    assert_source_unchanged(&source_hashes);
    assert_coverage(&stats);
    if corpus_required() && stats.encoded == 0 {
        panic!(
            "The corpus did not complete any encode. Skips: {}",
            stats.skipped.join("; ")
        );
    }

    let elapsed = started.elapsed().as_secs_f64();
    let older_ffmpeg = ffmpeg_major(&manifest.ffmpeg_version).is_some_and(|major| major < 7);
    let ffmpeg_label = if manifest.ffmpeg_version.is_empty() {
        "unknown".to_owned()
    } else {
        manifest.ffmpeg_version.clone()
    };
    let smoke = if older_ffmpeg {
        " | older-FFmpeg smoke test"
    } else {
        ""
    };
    eprintln!(
        "Corpus matrix: {} | FFmpeg: {ffmpeg_label}{smoke} | encodes: {} | clean rejections: {} | skipped: {} | elapsed: {elapsed:.1}s",
        if full { "full" } else { "reduced" },
        stats.encoded,
        stats.rejected,
        stats.skipped.len(),
    );
    for skip in &stats.skipped {
        eprintln!("skipped: {skip}");
    }
    for note in &stats.reported {
        eprintln!("reported: {note}");
    }
}

enum CorpusPrep {
    Skip(String),
    Ready(Manifest, CorpusDir),
}

struct CorpusDir(PathBuf);

impl Drop for CorpusDir {
    fn drop(&mut self) {
        remove_corpus_dir(&self.0);
    }
}

fn prepare_corpus() -> CorpusPrep {
    let root = repo_root();
    let script = root.join("scripts/corpus/generate.mjs");
    if !script.is_file() {
        return CorpusPrep::Skip(format!(
            "Corpus generator is missing at {}.",
            script.display()
        ));
    }
    let directory = std::env::temp_dir().join(format!(
        "vidra-corpus-{}-{}",
        std::process::id(),
        unique_nanos()
    ));
    fs::create_dir_all(&directory).expect("the corpus directory should be created");
    let corpus_directory = CorpusDir(directory.clone());
    let media = directory.join("media");
    let status = Command::new("node")
        .arg(&script)
        .arg("--output")
        .arg(&media)
        .current_dir(&root)
        .output();
    let output = match status {
        Ok(output) => output,
        Err(error) => {
            return CorpusPrep::Skip(format!(
                "Node is required to generate the corpus ({error})."
            ));
        }
    };
    if output.status.code() == Some(2) {
        return CorpusPrep::Skip(text(&output.stderr));
    }
    if !output.status.success() {
        panic!(
            "Corpus generation failed.\n{}",
            tail(&output.stderr).unwrap_or_else(|| text(&output.stdout))
        );
    }
    let manifest_path = media.join("manifest.json");
    let manifest: Manifest = serde_json::from_slice(
        &fs::read(&manifest_path).unwrap_or_else(|error| panic!("manifest: {error}")),
    )
    .unwrap_or_else(|error| panic!("manifest JSON: {error}"));
    CorpusPrep::Ready(manifest, corpus_directory)
}

fn remove_corpus_dir(path: &Path) {
    if env::var("VIDRA_CORPUS_KEEP").ok().as_deref() == Some("1") {
        eprintln!("Kept corpus directory {}", path.display());
        return;
    }
    let _ = fs::remove_dir_all(path);
}

struct CaseInput<'a> {
    clip_id: &'a str,
    media: &'a MediaInfo,
    source_side_data: &'a [String],
    case: Case,
}

struct EncodeTools<'a> {
    ffmpeg: &'a Path,
    ffprobe: &'a Path,
    capabilities: &'a Capabilities,
}

fn run_case(input: CaseInput<'_>, tools: &EncodeTools<'_>, stats: &mut Stats) {
    let CaseInput {
        clip_id,
        media,
        source_side_data,
        case,
    } = input;
    let label = case_label(clip_id, case);
    let output_directory = output_directory_for(&media.path);
    fs::create_dir_all(&output_directory).expect("the output directory should exist");
    let destination = output_directory.join(format!(
        "{}-{}.{}",
        sanitize(&label),
        unique_nanos(),
        case.container.extension()
    ));
    let destination = destination.to_str().expect("output paths are UTF-8");
    let input = validate_input(&media.path).unwrap_or_else(|error| {
        panic!("{label}: input path: {}", error.message);
    });
    let mut request = request_for(media, case, destination);
    let normalized = validate_output(
        &request.output_path,
        std::slice::from_ref(&input),
        case.container,
        ExistingOutput::Reject,
    )
    .unwrap_or_else(|error| panic!("{label}: output path: {}", error.message));
    request.output_path = normalized.to_string_lossy().into_owned();
    let partial = create_partial(
        &normalized,
        &format!("c{}", stats.encoded + stats.rejected),
        case.container.extension(),
        &[],
        std::slice::from_ref(&input),
    )
    .unwrap_or_else(|error| panic!("{label}: temporary output: {}", error.message));

    let job = pending_job(&label, request, media.clone());
    let arguments = match command_arguments(&job, &partial.path) {
        Ok(arguments) => arguments,
        Err(error) => {
            assert_cleanup(&label, discard_partial(&partial));
            assert_absent(&label, &normalized);
            expect_rejection(&label, case, media, &error);
            stats.rejected += 1;
            return;
        }
    };
    assert!(
        arguments
            .windows(2)
            .any(|pair| { pair[0] == "-progress" && pair[1] == "pipe:1" }),
        "{label}: encode arguments did not request progress on standard output"
    );

    if let Some(reason) = skip_reason(case, media, tools.capabilities) {
        assert_cleanup(&label, discard_partial(&partial));
        assert_absent(&label, &normalized);
        if strict_encoders() {
            panic!("{label}: {reason}");
        }
        stats.skipped.push(format!("{label}: {reason}"));
        return;
    }

    let ran =
        run_ffmpeg(tools.ffmpeg, &arguments).unwrap_or_else(|error| panic!("{label}: {error}"));
    if !ran.status.success() {
        let finalized = finalize_failed(&partial, &normalized, &input);
        assert_eq!(finalized.cleanup, PartialCleanup::Resolved, "{label}");
        assert!(finalized.saved_path.is_none(), "{label}");
        assert_absent(&label, &normalized);
        assert_no_partials(&output_directory, &label);
        panic!(
            "{label}: FFmpeg exited {:?}\n{}",
            ran.status.code(),
            tail(&ran.stderr).unwrap_or_default()
        );
    }

    if !progress_completed(&ran.stdout, media.duration_seconds) {
        let _ = finalize_failed(&partial, &normalized, &input);
        panic!("{label}: progress parsing did not reach completion");
    }
    let finalized = finalize_output(FinalizeRequest {
        partial: &partial,
        destination: &normalized,
        replace_identity: None,
        outcome: OutputOutcome::Completed,
        inputs: std::slice::from_ref(&input),
        reserved: &[],
        reserved_known: true,
    });
    assert_eq!(
        finalized.outcome,
        OutputOutcome::Completed,
        "{label}: {}",
        finalized
            .error
            .as_ref()
            .map(|error| error.message.as_str())
            .unwrap_or("the finished file was not published")
    );
    let saved = finalized
        .saved_path
        .unwrap_or_else(|| panic!("{label}: success did not publish a file"));
    assert_eq!(saved, normalized, "{label}: published an unexpected path");
    assert_no_partials(&output_directory, &label);
    let output = probe_with_binary(
        tools.ffprobe,
        saved.to_str().expect("published path is UTF-8"),
    )
    .unwrap_or_else(|error| panic!("{label}: output probe: {}", error.message));
    assert_output(&label, case, media, &output.media);
    report_static_hdr_metadata(
        &label,
        case,
        media,
        source_side_data,
        &output.video_side_data,
        stats,
    );
    stats.encoded += 1;
}

fn finalize_failed(
    partial: &crate::output::partial::PartialOutput,
    destination: &Path,
    input: &PathBuf,
) -> crate::output::partial::FinalizedOutput {
    finalize_output(FinalizeRequest {
        partial,
        destination,
        replace_identity: None,
        outcome: OutputOutcome::Failed,
        inputs: std::slice::from_ref(input),
        reserved: &[],
        reserved_known: true,
    })
}

fn expect_corrupt(ffprobe: &Path, clip: &Clip) {
    let error = probe_with_binary(ffprobe, &clip.path)
        .err()
        .unwrap_or_else(|| panic!("{}: truncated media was readable", clip.id));
    assert_eq!(error.code, "ffmpeg_error", "{}", clip.id);
    assert!(
        Path::new(&clip.path).is_file(),
        "{}: source was removed",
        clip.id
    );
}

fn expect_rejection(label: &str, case: Case, media: &MediaInfo, error: &ApiError) {
    let Some((code, message)) = expected_rejection(case, media) else {
        panic!(
            "{label}: encode was rejected before FFmpeg ({}, {})",
            error.code, error.message
        );
    };
    assert_eq!(error.code, code, "{label}: {}", error.message);
    assert!(
        error.message.contains(message),
        "{label}: expected message containing {message}, got {}",
        error.message
    );
}

fn expected_rejection(case: Case, media: &MediaInfo) -> Option<(&'static str, &'static str)> {
    // Match `video_arguments`: Dolby Vision is refused before the encoder is
    // chosen, and hardware encoding is refused before tone-map validation.
    if case.codec != VideoCodec::Copy
        && media.video.as_ref().is_some_and(|video| {
            video.hdr_format == Some(HdrFormat::DolbyVision) && !compatible_dolby(video)
        })
    {
        return Some(("invalid_input", "Dolby Vision"));
    }
    if case.speed == EncodingSpeed::Fast && !cfg!(target_os = "macos") {
        return Some(("unsupported_platform", "not supported on this platform"));
    }
    if case.codec == VideoCodec::Copy && media.video.is_none() {
        return Some(("invalid_input", "no video stream"));
    }
    if case.codec == VideoCodec::H264
        && media
            .video
            .as_ref()
            .is_some_and(|video| video.hdr_format == Some(HdrFormat::Hdr))
    {
        return Some(("invalid_input", "HDR transfer"));
    }
    None
}

fn assert_output(label: &str, case: Case, source: &MediaInfo, output: &MediaInfo) {
    match case.container {
        OutputContainer::Mp4 => assert!(
            output.format_name.contains("mp4"),
            "{label}: container {}",
            output.format_name
        ),
        OutputContainer::Mkv => assert!(
            output.format_name.contains("matroska"),
            "{label}: container {}",
            output.format_name
        ),
    }

    if source.video.is_none() {
        assert!(
            output.video.is_none(),
            "{label}: audio-only output has video"
        );
        assert!(!output.audio.is_empty(), "{label}: audio is missing");
        return;
    }
    let source_video = source.video.as_ref().expect("video");
    let output_video = output
        .video
        .as_ref()
        .unwrap_or_else(|| panic!("{label}: output has no video"));
    assert_eq!(
        (output_video.width, output_video.height),
        (source_video.width, source_video.height),
        "{label}: display size"
    );
    assert_eq!(
        output_video.codec,
        expected_codec(case.codec, &source_video.codec),
        "{label}"
    );
    if source.audio.is_empty() {
        assert!(output.audio.is_empty(), "{label}: unexpected audio");
    } else {
        assert!(!output.audio.is_empty(), "{label}: audio is missing");
    }
    if source
        .subtitles
        .iter()
        .any(|subtitle| subtitle.codec.eq_ignore_ascii_case("mov_text"))
    {
        let expected = match case.container {
            OutputContainer::Mp4 => "mov_text",
            OutputContainer::Mkv => "subrip",
        };
        assert!(
            output
                .subtitles
                .iter()
                .any(|subtitle| subtitle.codec.eq_ignore_ascii_case(expected)),
            "{label}: expected a {expected} subtitle, got {:?}",
            output
                .subtitles
                .iter()
                .map(|subtitle| subtitle.codec.as_str())
                .collect::<Vec<_>>()
        );
    }
    assert_hdr(label, case.codec, source_video, output_video);
}

fn report_static_hdr_metadata(
    label: &str,
    case: Case,
    source: &MediaInfo,
    source_side_data: &[String],
    output_side_data: &[String],
    stats: &mut Stats,
) {
    let hdr10 = source
        .video
        .as_ref()
        .is_some_and(|video| video.hdr_format == Some(HdrFormat::Hdr10));
    if !hdr10 || !matches!(case.codec, VideoCodec::H265 | VideoCodec::Av1) {
        return;
    }
    let (source_mastering, source_light) = static_hdr_metadata(source_side_data);
    let (output_mastering, output_light) = static_hdr_metadata(output_side_data);
    if output_mastering && output_light {
        return;
    }
    // FFmpeg 8.1.3 keeps this metadata on the re-encoded stream even when the
    // source only reports it on frames. Strict mode requires the output stream,
    // which is what Vidra reads. Older builds often have neither.
    let detail = format!(
        "{label}: stream-level static HDR metadata (source mastering={source_mastering}, content light={source_light}; output mastering={output_mastering}, content light={output_light}; source side data: {}; output side data: {})",
        side_data_list(source_side_data),
        side_data_list(output_side_data),
    );
    if strict_encoders() {
        panic!(
            "{detail}. The macOS sidecar must keep mastering display and content light on the video stream through H.265 and AV1 re-encoding, because that is what Vidra reads."
        );
    }
    stats.reported.push(format!(
        "{detail}. This older FFmpeg build often attaches that metadata only to frames, so the smoke test does not fail."
    ));
}

fn static_hdr_metadata(side_data: &[String]) -> (bool, bool) {
    let text = side_data.join(" ").to_ascii_lowercase();
    (
        text.contains("mastering display metadata"),
        text.contains("content light level metadata"),
    )
}

fn side_data_list(side_data: &[String]) -> String {
    if side_data.is_empty() {
        "none".to_owned()
    } else {
        side_data.join(", ")
    }
}

fn ffmpeg_major(version: &str) -> Option<u32> {
    let token = version.split_whitespace().nth(2)?;
    let token = token.trim_start_matches('n');
    token.split(['.', '-']).next()?.parse().ok()
}

fn assert_hdr(label: &str, codec: VideoCodec, source: &VideoStream, output: &VideoStream) {
    match (codec, source.hdr_format) {
        (
            VideoCodec::H264,
            Some(HdrFormat::Hdr10 | HdrFormat::Hlg | HdrFormat::Pq | HdrFormat::Hdr10Plus),
        ) => {
            assert_eq!(output.bit_depth, Some(8), "{label}");
            assert!(output.hdr_format.is_none(), "{label}: H.264 kept HDR");
            assert_bt709(label, output);
        }
        (VideoCodec::H264, Some(HdrFormat::DolbyVision)) => {
            assert_eq!(output.bit_depth, Some(8), "{label}");
            assert!(
                output.hdr_format.is_none(),
                "{label}: H.264 kept Dolby Vision"
            );
            assert_bt709(label, output);
        }
        (
            VideoCodec::H265 | VideoCodec::Av1,
            Some(format @ (HdrFormat::Hdr10 | HdrFormat::Hlg | HdrFormat::Pq)),
        ) => {
            assert_eq!(output.bit_depth, Some(10), "{label}");
            assert_eq!(output.hdr_format, Some(format), "{label}");
            assert_eq!(output.color_transfer, source.color_transfer, "{label}");
            assert_eq!(output.color_primaries.as_deref(), Some("bt2020"), "{label}");
            assert_eq!(output.color_space.as_deref(), Some("bt2020nc"), "{label}");
            assert_eq!(output.color_range.as_deref(), Some("tv"), "{label}");
        }
        (VideoCodec::H265 | VideoCodec::Av1, Some(HdrFormat::DolbyVision)) => {
            assert_eq!(output.bit_depth, Some(10), "{label}");
            assert_ne!(output.hdr_format, Some(HdrFormat::DolbyVision), "{label}");
        }
        (VideoCodec::H265 | VideoCodec::Av1, Some(HdrFormat::Hdr)) => {
            assert_eq!(output.bit_depth, Some(10), "{label}");
            assert_ne!(output.bit_depth, Some(8), "{label}");
        }
        (VideoCodec::Copy, Some(format)) => {
            assert_eq!(output.hdr_format, Some(format), "{label}");
            assert_eq!(output.bit_depth, source.bit_depth, "{label}");
        }
        (VideoCodec::H264, None) => {
            assert_eq!(output.bit_depth, Some(8), "{label}");
            if source.color_transfer.as_deref() == Some("bt709") {
                assert_bt709(label, output);
            }
        }
        (VideoCodec::H265 | VideoCodec::Av1, None) => {
            let expected_depth = source
                .bit_depth
                .filter(|depth| *depth > 8)
                .map(|_| 10)
                .or(Some(8));
            assert_eq!(output.bit_depth, expected_depth, "{label}");
            if source.color_transfer.as_deref() == Some("bt709") {
                assert_bt709(label, output);
            }
        }
        (VideoCodec::Copy, None) => {
            assert_eq!(output.bit_depth, source.bit_depth, "{label}");
        }
        (VideoCodec::H264, Some(HdrFormat::Hdr)) => {
            panic!("{label}: unknown HDR transfer was encoded with H.264");
        }
        (codec, Some(HdrFormat::Hdr10Plus)) => {
            assert!(
                matches!(codec, VideoCodec::H265 | VideoCodec::Av1 | VideoCodec::Copy),
                "{label}"
            );
            if codec != VideoCodec::Copy {
                assert_eq!(output.bit_depth, Some(10), "{label}");
            }
        }
    }
}

fn assert_bt709(label: &str, video: &VideoStream) {
    assert_eq!(video.color_primaries.as_deref(), Some("bt709"), "{label}");
    assert_eq!(video.color_transfer.as_deref(), Some("bt709"), "{label}");
    assert_eq!(video.color_space.as_deref(), Some("bt709"), "{label}");
    assert_eq!(video.color_range.as_deref(), Some("tv"), "{label}");
}

fn expected_codec(codec: VideoCodec, source_codec: &str) -> String {
    match codec {
        VideoCodec::H264 => "h264".to_owned(),
        VideoCodec::H265 => "hevc".to_owned(),
        VideoCodec::Av1 => "av1".to_owned(),
        VideoCodec::Copy => source_codec.to_owned(),
    }
}

fn compatible_dolby(video: &VideoStream) -> bool {
    video.dolby_vision.as_ref().is_some_and(|info| {
        matches!(info.base_layer_compatibility_id, Some(1 | 4)) && !info.has_enhancement_layer
    })
}

fn skip_reason(case: Case, media: &MediaInfo, capabilities: &Capabilities) -> Option<String> {
    if let Some(encoder) = encoder_name(case.codec, case.speed) {
        if !capabilities.encoders.contains(encoder) {
            return Some(format!(
                "encoder {encoder} is not available in this FFmpeg build"
            ));
        }
        if let Some(pixel_format) = required_pixel_format(case, media) {
            if !capabilities.supports_pixel_format(encoder, pixel_format) {
                return Some(format!(
                    "encoder {encoder} does not list the {pixel_format} pixel format"
                ));
            }
        }
    }
    if needs_tone_map(case.codec, media) {
        for filter in ["zscale", "tonemap"] {
            if !capabilities.filters.contains(filter) {
                return Some(format!(
                    "filter {filter} is not available, so H.264 HDR tone mapping cannot run"
                ));
            }
        }
    }
    None
}

fn encoder_name(codec: VideoCodec, speed: EncodingSpeed) -> Option<&'static str> {
    match (codec, speed) {
        (VideoCodec::Copy, _) => None,
        (VideoCodec::H264, EncodingSpeed::Efficient) => Some("libx264"),
        (VideoCodec::H265, EncodingSpeed::Efficient) => Some("libx265"),
        (VideoCodec::Av1, EncodingSpeed::Efficient) => Some("libsvtav1"),
        (VideoCodec::H264, EncodingSpeed::Fast) => Some("h264_videotoolbox"),
        (VideoCodec::H265, EncodingSpeed::Fast) => Some("hevc_videotoolbox"),
        (VideoCodec::Av1, EncodingSpeed::Fast) => None,
    }
}

fn required_pixel_format(case: Case, media: &MediaInfo) -> Option<&'static str> {
    if !matches!(case.codec, VideoCodec::H265 | VideoCodec::Av1) {
        return None;
    }
    let ten_bit = media.video.as_ref().is_some_and(|video| {
        video.hdr_format.is_some() || video.bit_depth.is_some_and(|depth| depth > 8)
    });
    if !ten_bit {
        return None;
    }
    Some(match case.speed {
        EncodingSpeed::Efficient => "yuv420p10le",
        EncodingSpeed::Fast => "p010le",
    })
}

fn needs_tone_map(codec: VideoCodec, media: &MediaInfo) -> bool {
    codec == VideoCodec::H264
        && media.video.as_ref().is_some_and(|video| {
            matches!(
                video.hdr_format,
                Some(
                    HdrFormat::Hdr10
                        | HdrFormat::Hlg
                        | HdrFormat::Pq
                        | HdrFormat::Hdr10Plus
                        | HdrFormat::DolbyVision
                )
            )
        })
}

fn request_for(media: &MediaInfo, case: Case, destination: &str) -> EncodeRequest {
    EncodeRequest {
        input_path: media.path.clone(),
        output_path: destination.to_owned(),
        quality: case.quality,
        container: case.container,
        video_codec: case.codec,
        encoding_speed: case.speed,
        audio_mode: AudioMode::Auto,
        output_resolution: OutputResolution::Source,
        output_frame_rate: OutputFrameRate::Source,
        quality_tuning: 0,
        audio_bitrate: AudioBitrate::Auto,
        audio_channels: AudioChannels::Source,
        audio_track_mode: AudioTrackMode::All,
        audio_stream_indexes: media.audio.iter().map(|stream| stream.index).collect(),
        subtitle_stream_indexes: media.subtitles.iter().map(|stream| stream.index).collect(),
        preserve_subtitles: true,
        preserve_metadata: true,
        preserve_chapters: true,
        replace_existing: false,
        allow_insufficient_disk_space: false,
        trim: None,
    }
}

fn pending_job(id: &str, request: EncodeRequest, media: MediaInfo) -> PendingJob {
    PendingJob {
        id: id.to_owned(),
        estimated_output_bytes: 0,
        request,
        media,
        ffmpeg_version: None,
        segment: None,
        ffmpeg_command: None,
    }
}

fn cases_for(role: &str, full: bool) -> Vec<Case> {
    if role == "corrupt" {
        return Vec::new();
    }
    let mut cases = Vec::new();
    if full {
        for quality in qualities() {
            for codec in [VideoCodec::H264, VideoCodec::H265, VideoCodec::Av1] {
                for container in [OutputContainer::Mp4, OutputContainer::Mkv] {
                    cases.push(Case {
                        quality,
                        container,
                        codec,
                        speed: EncodingSpeed::Efficient,
                    });
                    if codec != VideoCodec::Av1 {
                        cases.push(Case {
                            quality,
                            container,
                            codec,
                            speed: EncodingSpeed::Fast,
                        });
                    }
                }
            }
        }
    } else if role == "representative" {
        for quality in qualities() {
            cases.push(Case {
                quality,
                container: OutputContainer::Mp4,
                codec: VideoCodec::H264,
                speed: EncodingSpeed::Efficient,
            });
        }
        cases.push(Case {
            quality: QualityLevel::SmallerFile,
            container: OutputContainer::Mp4,
            codec: VideoCodec::H265,
            speed: EncodingSpeed::Efficient,
        });
        cases.push(Case {
            quality: QualityLevel::Balanced,
            container: OutputContainer::Mp4,
            codec: VideoCodec::H264,
            speed: EncodingSpeed::Fast,
        });
    }
    for codec in [
        VideoCodec::Copy,
        VideoCodec::H264,
        VideoCodec::H265,
        VideoCodec::Av1,
    ] {
        for container in [OutputContainer::Mp4, OutputContainer::Mkv] {
            cases.push(Case {
                quality: QualityLevel::Balanced,
                container,
                codec,
                speed: EncodingSpeed::Efficient,
            });
        }
    }
    dedup(cases)
}

fn dedup(cases: Vec<Case>) -> Vec<Case> {
    let mut seen = HashSet::new();
    cases
        .into_iter()
        .filter(|case| {
            seen.insert((
                case.quality as u8,
                case.container as u8,
                case.codec as u8,
                case.speed as u8,
            ))
        })
        .collect()
}

fn qualities() -> [QualityLevel; 5] {
    [
        QualityLevel::MaximumCompression,
        QualityLevel::SmallerFile,
        QualityLevel::Balanced,
        QualityLevel::HighQuality,
        QualityLevel::NearSource,
    ]
}

fn record_case(stats: &mut Stats, case: &Case) {
    if !stats.qualities.contains(&case.quality) {
        stats.qualities.push(case.quality);
    }
    if !stats.codecs.contains(&case.codec) {
        stats.codecs.push(case.codec);
    }
    if !stats.containers.contains(&case.container) {
        stats.containers.push(case.container);
    }
    if let Some(profile) = profile_name(*case) {
        stats.profiles.insert(profile);
    }
}

fn profile_name(case: Case) -> Option<&'static str> {
    match (case.quality, case.container, case.codec, case.speed) {
        (
            QualityLevel::Balanced,
            OutputContainer::Mp4,
            VideoCodec::H264,
            EncodingSpeed::Efficient,
        ) => Some("Balanced"),
        (
            QualityLevel::SmallerFile,
            OutputContainer::Mp4,
            VideoCodec::H265,
            EncodingSpeed::Efficient,
        ) => Some("Smaller file"),
        (QualityLevel::Balanced, OutputContainer::Mp4, VideoCodec::H264, EncodingSpeed::Fast) => {
            Some("Fast export")
        }
        _ => None,
    }
}

fn assert_coverage(stats: &Stats) {
    for profile in ["Balanced", "Smaller file", "Fast export"] {
        assert!(
            stats.profiles.contains(profile),
            "missing profile {profile}"
        );
    }
    for quality in qualities() {
        assert!(stats.qualities.contains(&quality), "missing {quality:?}");
    }
    for codec in [
        VideoCodec::Copy,
        VideoCodec::H264,
        VideoCodec::H265,
        VideoCodec::Av1,
    ] {
        assert!(stats.codecs.contains(&codec), "missing {codec:?}");
    }
    for container in [OutputContainer::Mp4, OutputContainer::Mkv] {
        assert!(
            stats.containers.contains(&container),
            "missing {container:?}"
        );
    }
}

fn progress_completed(stdout: &[u8], duration_seconds: f64) -> bool {
    let mut parser = ProgressParser::default();
    let mut completed = false;
    for line in String::from_utf8_lossy(stdout).lines() {
        if let Some(progress) = parser.update("corpus", duration_seconds, line) {
            if progress.percent == 100.0 && !progress.indeterminate {
                completed = true;
            }
        }
    }
    completed
}

struct FfmpegRun {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_ffmpeg(binary: &Path, arguments: &[std::ffi::OsString]) -> Result<FfmpegRun, String> {
    let mut child = Command::new(binary)
        .args(arguments)
        .env("AV_LOG_FORCE_NOCOLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("unable to start FFmpeg: {error}"))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let stdout_thread = thread::spawn(move || read_pipe(&mut stdout));
    let stderr_thread = thread::spawn(move || read_pipe(&mut stderr));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > Duration::from_secs(90) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("FFmpeg exceeded 90 seconds".to_owned());
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => return Err(format!("unable to wait for FFmpeg: {error}")),
        }
    };
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    Ok(FfmpegRun {
        status,
        stdout,
        stderr,
    })
}

fn read_pipe(pipe: &mut Option<impl Read>) -> Vec<u8> {
    let mut bytes = Vec::new();
    if let Some(pipe) = pipe.as_mut() {
        let _ = pipe.read_to_end(&mut bytes);
    }
    bytes
}

impl Capabilities {
    fn load(ffmpeg: &Path) -> Self {
        let encoders = capability_names(&command_text(ffmpeg, &["-hide_banner", "-encoders"]));
        let filters = capability_names(&command_text(ffmpeg, &["-hide_banner", "-filters"]));
        let encoder_help = [
            "libx264",
            "libx265",
            "libsvtav1",
            "h264_videotoolbox",
            "hevc_videotoolbox",
        ]
        .into_iter()
        .filter(|name| encoders.contains(*name))
        .map(|name| {
            let help = command_text(ffmpeg, &["-hide_banner", "-h", &format!("encoder={name}")]);
            (name.to_owned(), help)
        })
        .collect();
        Self {
            encoders,
            filters,
            encoder_help,
        }
    }

    fn supports_pixel_format(&self, encoder: &str, pixel_format: &str) -> bool {
        self.encoder_help
            .iter()
            .find(|(name, _)| name == encoder)
            .is_some_and(|(_, help)| help.contains(pixel_format))
    }

    fn require_strict(&self) {
        let mut missing = Vec::new();
        for name in [
            "libx264",
            "libx265",
            "libsvtav1",
            "aac",
            "zscale",
            "tonemap",
        ] {
            let present = if name == "zscale" || name == "tonemap" {
                self.filters.contains(name)
            } else {
                self.encoders.contains(name)
            };
            if !present {
                missing.push(name.to_owned());
            }
        }
        for encoder in ["libx265", "libsvtav1"] {
            if !self.supports_pixel_format(encoder, "yuv420p10le") {
                missing.push(format!("{encoder} yuv420p10le"));
            }
        }
        #[cfg(target_os = "macos")]
        for encoder in ["h264_videotoolbox", "hevc_videotoolbox"] {
            if !self.encoders.contains(encoder) {
                missing.push(encoder.to_owned());
            }
        }
        if !missing.is_empty() {
            panic!(
                "This FFmpeg build is missing encoders or filters required by the corpus: {}",
                missing.join(", ")
            );
        }
    }
}

fn capability_names(text: &str) -> HashSet<String> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            // FFmpeg 6 prints three filter flags. FFmpeg 8 prints two.
            if !(2..=6).contains(&flags.len())
                || !flags
                    .chars()
                    .all(|character| character == '.' || character.is_ascii_alphabetic())
            {
                return None;
            }
            let name = parts.next()?;
            name.chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
                .then(|| name.to_owned())
        })
        .collect()
}

fn command_text(binary: &Path, arguments: &[&str]) -> String {
    let output = Command::new(binary)
        .args(arguments)
        .output()
        .unwrap_or_else(|error| panic!("unable to run {}: {error}", binary.display()));
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn assert_source_unchanged(hashes: &[(PathBuf, String)]) {
    for (path, hash) in hashes {
        assert!(path.is_file(), "source disappeared: {}", path.display());
        assert_eq!(
            file_hash(path),
            *hash,
            "source was modified: {}",
            path.display()
        );
    }
}

fn assert_cleanup(label: &str, cleanup: PartialCleanup) {
    assert_eq!(
        cleanup,
        PartialCleanup::Resolved,
        "{label}: temporary output remained"
    );
}

fn assert_absent(label: &str, path: &Path) {
    assert!(
        !path.exists(),
        "{label}: destination was written: {}",
        path.display()
    );
}

fn assert_no_partials(directory: &Path, label: &str) {
    let entries = fs::read_dir(directory).unwrap_or_else(|error| panic!("{label}: {error}"));
    for entry in entries {
        let entry = entry.unwrap_or_else(|error| panic!("{label}: {error}"));
        let name = entry.file_name();
        let name = name.to_string_lossy();
        assert!(
            !name.starts_with(".vidra-partial-"),
            "{label}: unfinished output remained ({name})"
        );
    }
}

fn output_directory_for(source: &str) -> PathBuf {
    Path::new(source)
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new(source))
        .join("outputs")
}

fn file_hash(path: &Path) -> String {
    let bytes = fs::read(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    hex(&sha256(&bytes))
}

fn case_label(clip_id: &str, case: Case) -> String {
    format!(
        "{clip_id} {} {} {} {}",
        codec_label(case.codec),
        container_label(case.container),
        quality_label(case.quality),
        speed_label(case.speed),
    )
}

fn codec_label(codec: VideoCodec) -> &'static str {
    match codec {
        VideoCodec::Copy => "copy",
        VideoCodec::H264 => "h264",
        VideoCodec::H265 => "h265",
        VideoCodec::Av1 => "av1",
    }
}

fn container_label(container: OutputContainer) -> &'static str {
    match container {
        OutputContainer::Mp4 => "mp4",
        OutputContainer::Mkv => "mkv",
    }
}

fn quality_label(quality: QualityLevel) -> &'static str {
    match quality {
        QualityLevel::MaximumCompression => "maximum-compression",
        QualityLevel::SmallerFile => "smaller-file",
        QualityLevel::Balanced => "balanced",
        QualityLevel::HighQuality => "high-quality",
        QualityLevel::NearSource => "near-source",
    }
}

fn speed_label(speed: EncodingSpeed) -> &'static str {
    match speed {
        EncodingSpeed::Efficient => "efficient",
        EncodingSpeed::Fast => "fast",
    }
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .expect("the repository root should resolve")
}

fn full_matrix() -> bool {
    match env::var("VIDRA_CORPUS_MATRIX") {
        Ok(value) if value == "full" => true,
        Ok(value) if value.is_empty() || value == "reduced" => false,
        Ok(value) => panic!("VIDRA_CORPUS_MATRIX must be reduced or full, not {value}."),
        Err(_) => false,
    }
}

fn corpus_required() -> bool {
    env_flag("VIDRA_CORPUS_REQUIRED")
}

fn strict_encoders() -> bool {
    env_flag("VIDRA_CORPUS_STRICT_ENCODERS")
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE")
    )
}

fn unique_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_owned()
}

fn tail(bytes: &[u8]) -> Option<String> {
    let text = text(bytes);
    if text.is_empty() {
        None
    } else {
        let lines: Vec<&str> = text.lines().collect();
        let start = lines.len().saturating_sub(25);
        Some(lines[start..].join("\n"))
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(DIGITS[(byte >> 4) as usize] as char);
        encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn sha256(message: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut state: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let bit_length = (message.len() as u64).wrapping_mul(8);
    let mut data = message.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_length.to_be_bytes());

    for chunk in data.chunks(64) {
        let mut words = [0u32; 64];
        for (index, word) in words.iter_mut().take(16).enumerate() {
            let start = index * 4;
            *word = u32::from_be_bytes(chunk[start..start + 4].try_into().expect("chunk"));
        }
        for index in 16..64 {
            let small = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let large = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(small)
                .wrapping_add(words[index - 7])
                .wrapping_add(large);
        }
        let mut a = state[0];
        let mut b = state[1];
        let mut c = state[2];
        let mut d = state[3];
        let mut e = state[4];
        let mut f = state[5];
        let mut g = state[6];
        let mut h = state[7];
        for index in 0..64 {
            let sum1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ ((!e) & g);
            let temporary1 = h
                .wrapping_add(sum1)
                .wrapping_add(choice)
                .wrapping_add(K[index])
                .wrapping_add(words[index]);
            let sum0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temporary2 = sum0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temporary1);
            d = c;
            c = b;
            b = a;
            a = temporary1.wrapping_add(temporary2);
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
        state[4] = state[4].wrapping_add(e);
        state[5] = state[5].wrapping_add(f);
        state[6] = state[6].wrapping_add(g);
        state[7] = state[7].wrapping_add(h);
    }

    let mut digest = [0u8; 32];
    for (index, value) in state.iter().enumerate() {
        digest[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    digest
}
