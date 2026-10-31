//! Optional start and end bounds for one conversion.
//!
//! The source file is only read. These helpers decide the FFmpeg options that
//! limit the output to the selected segment and the duration used for progress.
//! The accuracy choice is documented in `docs/TRIM.md`.

use super::SegmentTrim;
use crate::error::{ApiError, ApiResult};

const MILLISECOND: f64 = 0.001;

pub(crate) const INVALID_TIME: &str = "Enter a valid start and end time.";
pub(crate) const NEGATIVE_TIME: &str = "Start and end times cannot be negative.";
pub(crate) const END_NOT_AFTER_START: &str = "The end time must be later than the start time.";
pub(crate) const START_AFTER_VIDEO: &str = "The start time is past the end of the video.";
pub(crate) const END_AFTER_VIDEO: &str = "The end time is past the end of the video.";
pub(crate) const UNKNOWN_DURATION: &str =
    "This video's duration is unknown, so a segment cannot be selected.";

pub(crate) struct TrimCommand {
    pub input: Vec<String>,
    pub output: Vec<String>,
}

/// Returns the segment FFmpeg should write, or `None` when the selection is
/// the whole video. Values within half a millisecond of a bound are accepted
/// so a time rounded for display still matches the probed duration.
pub(crate) fn normalize_trim(
    trim: Option<SegmentTrim>,
    duration_seconds: f64,
) -> ApiResult<Option<SegmentTrim>> {
    let Some(trim) = trim else {
        return Ok(None);
    };
    if !trim.start_seconds.is_finite() || !trim.end_seconds.is_finite() {
        return Err(ApiError::invalid_input(INVALID_TIME));
    }
    if trim.start_seconds < -MILLISECOND / 2.0 || trim.end_seconds < -MILLISECOND / 2.0 {
        return Err(ApiError::invalid_input(NEGATIVE_TIME));
    }
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return Err(ApiError::invalid_input(UNKNOWN_DURATION));
    }

    let start = trim.start_seconds.max(0.0);
    let end = trim.end_seconds.max(0.0);
    if start > duration_seconds + MILLISECOND / 2.0 {
        return Err(ApiError::invalid_input(START_AFTER_VIDEO));
    }
    if end > duration_seconds + MILLISECOND / 2.0 {
        return Err(ApiError::invalid_input(END_AFTER_VIDEO));
    }

    let start = start.min(duration_seconds);
    let end = end.min(duration_seconds);
    if end - start < MILLISECOND / 2.0 {
        return Err(ApiError::invalid_input(END_NOT_AFTER_START));
    }
    if start <= MILLISECOND / 2.0 && duration_seconds - end <= MILLISECOND / 2.0 {
        return Ok(None);
    }

    Ok(Some(SegmentTrim {
        start_seconds: start,
        end_seconds: end,
    }))
}

pub(crate) fn output_duration_seconds(trim: Option<SegmentTrim>, source_duration: f64) -> f64 {
    match normalize_trim(trim, source_duration) {
        Ok(Some(segment)) => segment.end_seconds - segment.start_seconds,
        _ => source_duration,
    }
}

pub(crate) fn segment_fraction(trim: Option<SegmentTrim>, source_duration: f64) -> f64 {
    if !source_duration.is_finite() || source_duration <= 0.0 {
        return 1.0;
    }
    match normalize_trim(trim, source_duration) {
        Ok(Some(segment)) => {
            ((segment.end_seconds - segment.start_seconds) / source_duration).clamp(0.0, 1.0)
        }
        _ => 1.0,
    }
}

/// Input options belong before `-i`. Output options belong after it.
///
/// Re-encoded video uses FFmpeg's default accurate seek, then limits the
/// written duration. Copied audio and subtitle packets from before the start
/// are dropped so they do not lead the picture.
///
/// Copied video cannot start between keyframes. Accurate seek is disabled so
/// every stream stays on that earlier point, and reading stops at the
/// requested end.
pub(crate) fn command_options(
    trim: Option<SegmentTrim>,
    duration_seconds: f64,
    copy_video: bool,
) -> ApiResult<TrimCommand> {
    let Some(segment) = normalize_trim(trim, duration_seconds)? else {
        return Ok(TrimCommand {
            input: Vec::new(),
            output: Vec::new(),
        });
    };

    let start = format_timestamp(segment.start_seconds);
    let end = format_timestamp(segment.end_seconds);
    if copy_video {
        Ok(TrimCommand {
            input: vec![
                "-noaccurate_seek".to_owned(),
                "-ss".to_owned(),
                start,
                "-to".to_owned(),
                end,
            ],
            output: vec!["-avoid_negative_ts".to_owned(), "make_zero".to_owned()],
        })
    } else {
        Ok(TrimCommand {
            input: vec!["-ss".to_owned(), start],
            output: vec![
                "-t".to_owned(),
                format_timestamp(segment.end_seconds - segment.start_seconds),
                "-copypriorss:a".to_owned(),
                "0".to_owned(),
                "-copypriorss:s".to_owned(),
                "0".to_owned(),
                "-avoid_negative_ts".to_owned(),
                "make_zero".to_owned(),
            ],
        })
    }
}

pub(crate) fn format_timestamp(seconds: f64) -> String {
    let millis = if seconds.is_finite() {
        (seconds * 1000.0).round().max(0.0)
    } else {
        0.0
    };
    let millis = millis as u64;
    let whole = millis / 1000;
    let fraction = millis % 1000;
    if fraction == 0 {
        return whole.to_string();
    }

    let mut text = format!("{whole}.{fraction:03}");
    while text.ends_with('0') {
        text.pop();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::{
        command_options, format_timestamp, normalize_trim, output_duration_seconds,
        END_AFTER_VIDEO, END_NOT_AFTER_START, INVALID_TIME, NEGATIVE_TIME, START_AFTER_VIDEO,
        UNKNOWN_DURATION,
    };
    use crate::ffmpeg::SegmentTrim;

    fn trim(start: f64, end: f64) -> Option<SegmentTrim> {
        Some(SegmentTrim {
            start_seconds: start,
            end_seconds: end,
        })
    }

    #[test]
    fn rejects_ranges_that_cannot_be_cut() {
        let cases = [
            (trim(f64::NAN, 1.0), 10.0, INVALID_TIME),
            (trim(1.0, f64::INFINITY), 10.0, INVALID_TIME),
            (trim(-1.0, 4.0), 10.0, NEGATIVE_TIME),
            (trim(1.0, -0.2), 10.0, NEGATIVE_TIME),
            (trim(4.0, 4.0), 10.0, END_NOT_AFTER_START),
            (trim(6.0, 4.0), 10.0, END_NOT_AFTER_START),
            (trim(11.0, 12.0), 10.0, START_AFTER_VIDEO),
            (trim(1.0, 10.01), 10.0, END_AFTER_VIDEO),
            (trim(1.0, 2.0), 0.0, UNKNOWN_DURATION),
            (trim(1.0, 2.0), f64::NAN, UNKNOWN_DURATION),
        ];

        for (selection, duration, message) in cases {
            let error = normalize_trim(selection, duration).unwrap_err();
            assert_eq!(error.code, "invalid_input");
            assert_eq!(error.message, message);
        }
    }

    #[test]
    fn accepts_a_range_inside_the_video_and_ignores_the_whole_file() {
        let segment = normalize_trim(trim(1.25, 4.5), 10.0)
            .unwrap()
            .expect("a partial segment");
        assert_eq!(segment.start_seconds, 1.25);
        assert_eq!(segment.end_seconds, 4.5);
        assert_eq!(output_duration_seconds(trim(1.25, 4.5), 10.0), 3.25);

        assert!(normalize_trim(None, 10.0).unwrap().is_none());
        assert!(normalize_trim(trim(0.0, 10.0), 10.0).unwrap().is_none());
        assert!(normalize_trim(trim(0.0004, 10.0004), 10.0)
            .unwrap()
            .is_none());
        assert_eq!(output_duration_seconds(None, 10.0), 10.0);
        assert_eq!(output_duration_seconds(trim(0.0, 10.0), 10.0), 10.0);
    }

    #[test]
    fn re_encoded_video_seeks_accurately_and_copied_video_keeps_a_decodable_start() {
        let encoded = command_options(trim(1.5, 4.0), 10.0, false).unwrap();
        assert_eq!(encoded.input, ["-ss", "1.5"]);
        assert!(encoded.output.windows(2).any(|pair| pair == ["-t", "2.5"]));
        assert!(encoded
            .output
            .windows(2)
            .any(|pair| pair == ["-copypriorss:a", "0"]));
        assert!(encoded
            .output
            .windows(2)
            .any(|pair| pair == ["-copypriorss:s", "0"]));
        assert!(!encoded
            .input
            .iter()
            .any(|argument| argument == "-noaccurate_seek"));

        let copied = command_options(trim(1.5, 4.0), 10.0, true).unwrap();
        assert_eq!(copied.input, ["-noaccurate_seek", "-ss", "1.5", "-to", "4"]);
        assert!(!copied.output.iter().any(|argument| argument == "-t"));
        assert!(!copied.input.iter().any(|argument| argument == "-t"));

        assert!(command_options(None, 10.0, false).unwrap().input.is_empty());
    }

    #[test]
    fn timestamps_use_a_stable_second_value() {
        assert_eq!(format_timestamp(0.0), "0");
        assert_eq!(format_timestamp(1.5), "1.5");
        assert_eq!(format_timestamp(1.25), "1.25");
        assert_eq!(format_timestamp(1.001), "1.001");
        assert_eq!(format_timestamp(90.0), "90");
    }
}
