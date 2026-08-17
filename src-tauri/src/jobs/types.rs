use crate::ffmpeg::{EncodeRequest, MediaInfo};
use tauri_plugin_shell::process::CommandChild;

pub struct PendingJob {
    pub id: String,
    pub request: EncodeRequest,
    pub media: MediaInfo,
    pub estimated_output_bytes: u64,
    pub ffmpeg_version: Option<String>,
}

pub struct ActiveJob {
    pub id: String,
    pub output_path: String,
    pub estimated_output_bytes: u64,
    pub child: Option<CommandChild>,
    pub process_id: Option<u32>,
    pub paused: bool,
}

#[derive(Debug, Clone)]
pub struct DiskSpaceReservation {
    pub output_path: String,
    pub remaining_bytes: u64,
}

pub enum CancelledJob {
    Active {
        child: CommandChild,
        process_id: u32,
    },
    Pending(Box<PendingJob>),
}

pub enum ReservedJob {
    Pending(Box<PendingJob>),
    Resumed(String),
}
