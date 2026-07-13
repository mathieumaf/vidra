use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::{EncodeRequest, MediaInfo},
};
use std::{
    collections::{HashSet, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri_plugin_shell::process::CommandChild;

pub(crate) mod process;

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

#[derive(Default)]
pub struct JobState {
    pub active: Option<ActiveJob>,
    pub pending: VecDeque<PendingJob>,
    cancelled: HashSet<String>,
}

#[derive(Default)]
pub struct JobManager {
    state: Mutex<JobState>,
    next_id: AtomicU64,
}

pub enum CancelledJob {
    Active {
        child: CommandChild,
        process_id: u32,
    },
    Pending(Box<PendingJob>),
}

impl JobManager {
    pub fn next_id(&self) -> String {
        format!("job-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1)
    }

    pub fn append(&self, jobs: Vec<PendingJob>) -> ApiResult<()> {
        let mut state = self.lock()?;
        let mut outputs = state
            .pending
            .iter()
            .map(|job| job.request.output_path.as_str())
            .collect::<HashSet<_>>();
        if let Some(active) = &state.active {
            outputs.insert(active.output_path.as_str());
        }
        if jobs
            .iter()
            .any(|job| !outputs.insert(job.request.output_path.as_str()))
        {
            return Err(ApiError::invalid_input(
                "A queued video already uses one of the selected output paths.",
            ));
        }

        drop(outputs);
        state.pending.extend(jobs);
        Ok(())
    }

    pub fn reserve_next(&self) -> ApiResult<Option<PendingJob>> {
        let mut state = self.lock()?;
        if state.active.is_some() {
            return Ok(None);
        }

        let Some(job) = state.pending.pop_front() else {
            return Ok(None);
        };

        state.active = Some(ActiveJob {
            id: job.id.clone(),
            output_path: job.request.output_path.clone(),
            child: None,
            process_id: None,
            paused: false,
        });
        Ok(Some(job))
    }

    pub fn attach_child(&self, job_id: &str, child: CommandChild) -> ApiResult<()> {
        // Cache the PID before FFmpeg can be suspended. On macOS, querying the
        // shell child after SIGSTOP can block behind its internal wait lock.
        let process_id = child.pid();
        let mut state = self.lock()?;
        let active = state.active.as_mut().ok_or_else(|| {
            ApiError::new(
                "job_state_error",
                "The reserved encoding job is unavailable.",
            )
        })?;

        if active.id != job_id {
            return Err(ApiError::new(
                "job_state_error",
                "The reserved encoding job changed unexpectedly.",
            ));
        }

        active.child = Some(child);
        active.process_id = Some(process_id);
        Ok(())
    }

    pub fn finish_active(&self, job_id: &str) -> ApiResult<()> {
        let mut state = self.lock()?;
        if state.active.as_ref().map(|job| job.id.as_str()) == Some(job_id) {
            state.active.take();
        }
        Ok(())
    }

    pub fn set_paused(&self, job_id: &str, paused: bool) -> ApiResult<()> {
        let mut state = self.lock()?;
        let active = state
            .active
            .as_mut()
            .filter(|job| job.id == job_id)
            .ok_or_else(|| ApiError::invalid_input("The requested encoding job is not active."))?;
        let process_id = active.process_id.ok_or_else(|| {
            ApiError::new("job_state_error", "The encoding process is still starting.")
        })?;
        process::set_paused(process_id, paused)?;
        active.paused = paused;
        Ok(())
    }

    pub fn cancel(&self, job_id: &str) -> ApiResult<CancelledJob> {
        let mut state = self.lock()?;

        if state.active.as_ref().map(|job| job.id.as_str()) == Some(job_id) {
            let active = state.active.as_mut().expect("the active job was checked");
            let process_id = active.process_id.ok_or_else(|| {
                ApiError::new("job_state_error", "The encoding process is still starting.")
            })?;
            let child = active.child.take().ok_or_else(|| {
                ApiError::new("job_state_error", "The encoding process is still starting.")
            })?;
            state.cancelled.insert(job_id.to_owned());
            return Ok(CancelledJob::Active { child, process_id });
        }

        let Some(index) = state.pending.iter().position(|job| job.id == job_id) else {
            return Err(ApiError::invalid_input(
                "The requested encoding job is not queued.",
            ));
        };
        let job = state
            .pending
            .remove(index)
            .expect("a located pending job must exist");
        Ok(CancelledJob::Pending(Box::new(job)))
    }

    pub fn move_pending(&self, job_id: &str, direction: i8) -> ApiResult<()> {
        if !matches!(direction, -1 | 1) {
            return Err(ApiError::invalid_input(
                "Queue movement must be either -1 or 1.",
            ));
        }

        let mut state = self.lock()?;
        let index = state
            .pending
            .iter()
            .position(|job| job.id == job_id)
            .ok_or_else(|| ApiError::invalid_input("Only pending jobs can be reordered."))?;
        let destination = index as isize + direction as isize;
        if destination < 0 || destination >= state.pending.len() as isize {
            return Ok(());
        }
        state.pending.swap(index, destination as usize);
        Ok(())
    }

    pub fn take_cancelled(&self, job_id: &str) -> bool {
        self.state
            .lock()
            .map(|mut state| state.cancelled.remove(job_id))
            .unwrap_or(false)
    }

    fn lock(&self) -> ApiResult<std::sync::MutexGuard<'_, JobState>> {
        self.state
            .lock()
            .map_err(|_| ApiError::new("job_state_error", "Unable to access the job queue."))
    }
}

#[cfg(test)]
mod tests {
    use super::{JobManager, PendingJob};
    use crate::ffmpeg::{EncodeRequest, MediaInfo, OutputContainer, QualityLevel, VideoCodec};

    fn pending(id: &str) -> PendingJob {
        PendingJob {
            id: id.to_owned(),
            request: EncodeRequest {
                input_path: format!("/{id}.mov"),
                output_path: format!("/{id}.mp4"),
                quality: QualityLevel::Balanced,
                container: OutputContainer::Mp4,
                video_codec: VideoCodec::H264,
            },
            media: MediaInfo {
                path: format!("/{id}.mov"),
                name: format!("{id}.mov"),
                duration_seconds: 10.0,
                size_bytes: 100,
                format_name: "mov".to_owned(),
                video: None,
                audio: vec![],
            },
        }
    }

    #[test]
    fn pending_jobs_can_be_reordered() {
        let manager = JobManager::default();
        manager
            .append(vec![pending("one"), pending("two"), pending("three")])
            .unwrap();

        manager.move_pending("three", -1).unwrap();

        assert_eq!(manager.reserve_next().unwrap().unwrap().id, "one");
        manager.finish_active("one").unwrap();
        assert_eq!(manager.reserve_next().unwrap().unwrap().id, "three");
    }

    #[test]
    fn rejects_output_paths_already_used_by_the_queue() {
        let manager = JobManager::default();
        manager.append(vec![pending("one")]).unwrap();
        let mut duplicate = pending("two");
        duplicate.request.output_path = "/one.mp4".to_owned();

        assert!(manager.append(vec![duplicate]).is_err());
    }
}
