//! Files prepared for one trimmed job.
//!
//! The queue owns this state on the pending job. Temporary files are removed
//! when the job finishes, fails, or is cancelled.

use std::{fs, path::PathBuf};

#[derive(Debug, Clone)]
pub(crate) struct PreparedSegment {
    pub output_start: f64,
    pub output_end: f64,
    pub directory: PathBuf,
    pub chapter_file: Option<PathBuf>,
    pub text_subtitle_files: Vec<PathBuf>,
    /// Source indexes corresponding to the clipped files, in input order.
    pub text_subtitle_indexes: Vec<u32>,
    /// Selected source streams, retaining their order and track metadata.
    pub subtitles: Vec<crate::ffmpeg::SubtitleStream>,
    pub image_subtitle_count: usize,
    /// Stream copy normalizes timestamps while muxing. Text cues are added in
    /// a second copy after that, so their times stay on the output timeline.
    pub remux_text_subtitles: bool,
}

impl PreparedSegment {
    pub(crate) fn discard_files(self) {
        let _ = fs::remove_dir_all(self.directory);
    }
}
