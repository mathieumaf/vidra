use super::{process, ActiveJob, CancelledJob, PendingJob, ReservedJob};
use crate::error::{ApiError, ApiResult};
use std::{
    collections::{HashSet, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri_plugin_shell::process::CommandChild;

#[derive(Default)]
struct JobState {
    active: Option<ActiveJob>,
    suspended: VecDeque<ActiveJob>,
    pending: VecDeque<PendingJob>,
    waiting_order: VecDeque<String>,
    cancelled: HashSet<String>,
}

#[derive(Default)]
pub struct JobManager {
    state: Mutex<JobState>,
    next_id: AtomicU64,
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
        outputs.extend(state.suspended.iter().map(|job| job.output_path.as_str()));
        if jobs
            .iter()
            .any(|job| !outputs.insert(job.request.output_path.as_str()))
        {
            return Err(ApiError::invalid_input(
                "A queued video already uses one of the selected output paths.",
            ));
        }

        drop(outputs);
        state
            .waiting_order
            .extend(jobs.iter().map(|job| job.id.clone()));
        state.pending.extend(jobs);
        Ok(())
    }

    pub fn reserve_next(&self) -> ApiResult<Option<ReservedJob>> {
        let mut state = self.lock()?;
        if state.active.is_some() {
            return Ok(None);
        }

        let Some(job_id) = state.waiting_order.front().cloned() else {
            return Ok(None);
        };

        if let Some(index) = state.pending.iter().position(|job| job.id == job_id) {
            let job = state
                .pending
                .remove(index)
                .expect("the pending job was located");
            state.waiting_order.pop_front();
            state.active = Some(ActiveJob {
                id: job.id.clone(),
                output_path: job.request.output_path.clone(),
                child: None,
                process_id: None,
                paused: false,
            });
            return Ok(Some(ReservedJob::Pending(Box::new(job))));
        }

        if let Some(index) = state.suspended.iter().position(|job| job.id == job_id) {
            let process_id = state.suspended[index].process_id.ok_or_else(|| {
                ApiError::new("job_state_error", "The encoding process is unavailable.")
            })?;
            process::set_paused(process_id, false)?;

            let mut resumed = state
                .suspended
                .remove(index)
                .expect("the suspended job was located");
            resumed.paused = false;
            state.waiting_order.pop_front();
            state.active = Some(resumed);
            return Ok(Some(ReservedJob::Resumed(job_id)));
        }

        Err(ApiError::new(
            "job_state_error",
            "The next queued encoding job is unavailable.",
        ))
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
        } else if let Some(index) = state.suspended.iter().position(|job| job.id == job_id) {
            state.suspended.remove(index);
            state.waiting_order.retain(|id| id != job_id);
        }
        Ok(())
    }

    pub fn set_paused(&self, job_id: &str, paused: bool) -> ApiResult<()> {
        let mut state = self.lock()?;
        if paused {
            let active = state
                .active
                .as_ref()
                .filter(|job| job.id == job_id)
                .ok_or_else(|| {
                    ApiError::invalid_input("The requested encoding job is not running.")
                })?;
            let process_id = active.process_id.ok_or_else(|| {
                ApiError::new("job_state_error", "The encoding process is still starting.")
            })?;
            process::set_paused(process_id, true)?;

            let mut active = state.active.take().expect("the active job was checked");
            active.paused = true;
            state.suspended.push_back(active);
            state.waiting_order.push_front(job_id.to_owned());
            return Ok(());
        }

        if state.active.is_some() {
            return Err(ApiError::new(
                "encode_in_progress",
                "Pause the current encoding before resuming another video.",
            ));
        }

        if state.waiting_order.front().map(String::as_str) != Some(job_id) {
            return Err(ApiError::invalid_input(
                "Move this video to the front of the queue before resuming it.",
            ));
        }

        let index = state
            .suspended
            .iter()
            .position(|job| job.id == job_id)
            .ok_or_else(|| ApiError::invalid_input("The requested encoding job is not paused."))?;
        let process_id = state.suspended[index].process_id.ok_or_else(|| {
            ApiError::new("job_state_error", "The encoding process is unavailable.")
        })?;
        process::set_paused(process_id, false)?;

        let mut resumed = state
            .suspended
            .remove(index)
            .expect("the suspended job was located");
        resumed.paused = false;
        state.waiting_order.pop_front();
        state.active = Some(resumed);
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

        if let Some(index) = state.suspended.iter().position(|job| job.id == job_id) {
            let (process_id, child) = {
                let suspended = state
                    .suspended
                    .get_mut(index)
                    .expect("the suspended job was located");
                let process_id = suspended.process_id.ok_or_else(|| {
                    ApiError::new("job_state_error", "The encoding process is unavailable.")
                })?;
                let child = suspended.child.take().ok_or_else(|| {
                    ApiError::new("job_state_error", "The encoding process is unavailable.")
                })?;
                (process_id, child)
            };
            state.suspended.remove(index);
            state.waiting_order.retain(|id| id != job_id);
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
        state.waiting_order.retain(|id| id != job_id);
        Ok(CancelledJob::Pending(Box::new(job)))
    }

    pub fn move_waiting(&self, job_id: &str, direction: i8) -> ApiResult<()> {
        if !matches!(direction, -1 | 1) {
            return Err(ApiError::invalid_input(
                "Queue movement must be either -1 or 1.",
            ));
        }

        let mut state = self.lock()?;
        let index = state
            .waiting_order
            .iter()
            .position(|id| id == job_id)
            .ok_or_else(|| ApiError::invalid_input("Only waiting jobs can be reordered."))?;
        let destination = index as isize + direction as isize;
        if destination < 0 || destination >= state.waiting_order.len() as isize {
            return Ok(());
        }
        state.waiting_order.swap(index, destination as usize);
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
mod tests;
