use crate::ffmpeg::{EncodeRequest, MediaInfo};
use tauri_plugin_shell::process::CommandChild;

pub struct PendingJob {
    pub id: String,
    pub request: EncodeRequest,
    pub media: MediaInfo,
}

pub struct ActiveJob {
    pub id: String,
    pub output_path: String,
    pub child: Option<CommandChild>,
    pub process_id: Option<u32>,
    pub paused: bool,
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
