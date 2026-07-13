use crate::error::{ApiError, ApiResult};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri_plugin_shell::process::CommandChild;

pub struct ActiveJob {
    pub id: String,
    pub child: CommandChild,
}

#[derive(Default)]
pub struct JobManager {
    pub active: Mutex<Option<ActiveJob>>,
    cancelled: Mutex<HashSet<String>>,
    next_id: AtomicU64,
}

impl JobManager {
    pub fn next_id(&self) -> String {
        format!("job-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1)
    }

    pub fn mark_cancelled(&self, job_id: &str) -> ApiResult<()> {
        self.cancelled
            .lock()
            .map_err(|_| ApiError::new("job_state_error", "Unable to access the job state."))?
            .insert(job_id.to_owned());
        Ok(())
    }

    pub fn take_cancelled(&self, job_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|mut jobs| jobs.remove(job_id))
            .unwrap_or(false)
    }
}
