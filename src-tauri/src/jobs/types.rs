use super::process::RunningProcess;
use super::PreparedSegment;
use crate::ffmpeg::{EncodeRequest, MediaInfo};
use crate::output::partial::PartialOutput;

pub struct PendingJob {
    pub id: String,
    pub request: EncodeRequest,
    pub media: MediaInfo,
    pub estimated_output_bytes: u64,
    pub ffmpeg_version: Option<String>,
    /// Chapters and clipped subtitles for a trimmed conversion.
    pub segment: Option<PreparedSegment>,
    /// Redacted FFmpeg command lines that actually ran, captured before the
    /// segment files are removed so a failure report cannot drift from them.
    pub ffmpeg_command: Option<String>,
}

impl PendingJob {
    pub(crate) fn discard_segment_files(&mut self) {
        if let Some(segment) = self.segment.take() {
            segment.discard_files();
        }
    }
}

pub struct ActiveJob {
    pub id: String,
    pub output_path: String,
    pub estimated_output_bytes: u64,
    pub process: Option<RunningProcess>,
    pub process_id: Option<u32>,
    pub paused: bool,
    pub partial: Option<PartialOutput>,
}

#[derive(Debug, Clone)]
pub struct DiskSpaceReservation {
    pub output_path: String,
    pub remaining_bytes: u64,
}

pub enum CancelledJob {
    Active {
        process: RunningProcess,
    },
    /// The job was reserved and preparing segment files, with no encoder yet.
    Preparing,
    Pending(Box<PendingJob>),
}

pub enum ReservedJob {
    Pending(Box<PendingJob>),
    Resumed(String),
}
