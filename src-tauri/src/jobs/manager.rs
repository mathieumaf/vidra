use super::{process, ActiveJob, CancelledJob, DiskSpaceReservation, PendingJob, ReservedJob};
use crate::{
    error::{ApiError, ApiResult},
    ffmpeg::paths::same_existing_file,
    output::partial::{discard_partial, PartialOutput},
    power::SleepPreventer,
};
use std::{
    collections::{HashSet, VecDeque},
    path::{Path, PathBuf},
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
    update_in_progress: bool,
    /// Set while a reserved job is probing or extracting segment files.
    preparing_job: Option<String>,
    preparing_process: Option<process::RunningProcess>,
}

pub struct UpdateGuard<'a> {
    manager: &'a JobManager,
}

impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.manager.state.lock() {
            state.update_in_progress = false;
        }
    }
}

pub struct JobManager {
    state: Mutex<JobState>,
    next_id: AtomicU64,
    sleep_preventer: SleepPreventer,
}

impl Default for JobManager {
    fn default() -> Self {
        Self {
            state: Mutex::new(JobState::default()),
            next_id: AtomicU64::new(0),
            sleep_preventer: SleepPreventer::default(),
        }
    }
}

impl JobManager {
    pub fn next_id(&self) -> String {
        format!("job-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1)
    }

    pub fn append(&self, jobs: Vec<PendingJob>) -> ApiResult<()> {
        let mut state = self.lock()?;
        if state.update_in_progress {
            return Err(ApiError::new(
                "update_in_progress",
                "Wait for the application update to finish before adding conversions.",
            ));
        }
        let mut inputs = state
            .pending
            .iter()
            .map(|job| job.request.input_path.as_str())
            .chain(
                state
                    .active
                    .iter()
                    .chain(state.suspended.iter())
                    .map(|job| job.input_path.as_str()),
            )
            .collect::<Vec<_>>();
        inputs.extend(jobs.iter().map(|job| job.request.input_path.as_str()));
        let mut outputs = state
            .pending
            .iter()
            .map(|job| job.request.output_path.as_str())
            .chain(
                state
                    .active
                    .iter()
                    .chain(state.suspended.iter())
                    .map(|job| job.output_path.as_str()),
            )
            .collect::<Vec<_>>();
        for job in &jobs {
            for output in &outputs {
                if paths_overlap(&job.request.output_path, output)? {
                    return Err(ApiError::invalid_input(
                        "A queued video already uses one of the selected output paths.",
                    ));
                }
            }
            outputs.push(&job.request.output_path);
        }
        // Validate both directions atomically: a new output cannot replace a
        // queued source, and a new source cannot be a pending replacement target.
        for output in &outputs {
            for input in &inputs {
                if paths_overlap(output, input)? {
                    return Err(ApiError::invalid_input(
                        "The output file must be different from every queued input file.",
                    ));
                }
            }
        }
        drop(inputs);
        drop(outputs);
        state
            .waiting_order
            .extend(jobs.iter().map(|job| job.id.clone()));
        state.pending.extend(jobs);
        Ok(())
    }

    pub fn disk_space_reservations(&self) -> ApiResult<Vec<DiskSpaceReservation>> {
        let (pending, running) = {
            let state = self.lock()?;
            let pending = state
                .pending
                .iter()
                .map(|job| (job.request.output_path.clone(), job.estimated_output_bytes))
                .collect::<Vec<_>>();
            let running = state
                .active
                .iter()
                .chain(state.suspended.iter())
                .map(|job| {
                    (
                        job.output_path.clone(),
                        job.estimated_output_bytes,
                        job.partial.as_ref().map(|partial| partial.path.clone()),
                    )
                })
                .collect::<Vec<_>>();
            (pending, running)
        };
        // An existing destination stays on disk until publish, so a pending job
        // still needs room for the whole new file.
        let mut reservations = pending
            .into_iter()
            .map(|(output_path, estimated_bytes)| DiskSpaceReservation {
                output_path,
                remaining_bytes: estimated_bytes,
            })
            .collect::<Vec<_>>();
        reservations.extend(running.into_iter().map(
            |(output_path, estimated_bytes, partial_path)| {
                let written = partial_path.as_deref().map(file_size).unwrap_or(0);
                DiskSpaceReservation {
                    remaining_bytes: estimated_bytes.saturating_sub(written),
                    output_path,
                }
            },
        ));
        Ok(reservations)
    }

    pub fn reserved_output_paths(&self) -> ApiResult<Vec<PathBuf>> {
        // A poisoned lock still holds the queue's paths. Treating that as an
        // empty list would let a numbered fallback take another job's name.
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut paths = state
            .pending
            .iter()
            .map(|job| PathBuf::from(&job.request.output_path))
            .collect::<Vec<_>>();
        for job in state.active.iter().chain(state.suspended.iter()) {
            paths.push(PathBuf::from(&job.output_path));
            for partial in job.partial.iter().chain(job.auxiliary_partial.iter()) {
                paths.push(partial.path.clone());
            }
        }
        Ok(paths)
    }

    pub(crate) fn input_paths(&self) -> ApiResult<Vec<PathBuf>> {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(state
            .pending
            .iter()
            .map(|job| PathBuf::from(&job.request.input_path))
            .chain(
                state
                    .active
                    .iter()
                    .chain(state.suspended.iter())
                    .map(|job| PathBuf::from(&job.input_path)),
            )
            .collect())
    }

    pub(crate) fn set_auxiliary_partial(
        &self,
        job_id: &str,
        partial: PartialOutput,
    ) -> ApiResult<()> {
        let mut state = self.lock()?;
        let active = state
            .active
            .as_mut()
            .filter(|job| job.id == job_id)
            .ok_or_else(|| {
                ApiError::new(
                    "job_state_error",
                    "The reserved encoding job is unavailable.",
                )
            })?;
        if active.auxiliary_partial.is_some() {
            return Err(ApiError::new(
                "job_state_error",
                "The conversion is already being finished.",
            ));
        }
        active.auxiliary_partial = Some(partial);
        Ok(())
    }

    pub(crate) fn clear_auxiliary_partial(&self, job_id: &str) -> ApiResult<()> {
        let mut state = self.lock()?;
        if let Some(active) = state.active.as_mut().filter(|job| job.id == job_id) {
            active.auxiliary_partial = None;
        }
        Ok(())
    }

    pub fn set_partial(&self, job_id: &str, partial: PartialOutput) -> ApiResult<()> {
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
        active.partial = Some(partial);
        Ok(())
    }

    pub fn clear_partial(&self, job_id: &str) -> ApiResult<()> {
        let mut state = self.lock()?;
        if let Some(active) = state.active.as_mut().filter(|job| job.id == job_id) {
            active.partial = None;
        }
        Ok(())
    }

    pub fn reserve_next(&self) -> ApiResult<Option<ReservedJob>> {
        let mut state = self.lock()?;
        if state.update_in_progress {
            return Err(ApiError::new(
                "update_in_progress",
                "Wait for the application update to finish before starting a conversion.",
            ));
        }
        if state.active.is_some() {
            return Ok(None);
        }

        let Some(job_id) = state.waiting_order.front().cloned() else {
            return Ok(None);
        };

        if let Some(index) = state.pending.iter().position(|job| job.id == job_id) {
            self.sleep_preventer.activate()?;
            let job = state
                .pending
                .remove(index)
                .expect("the pending job was located");
            state.waiting_order.pop_front();
            state.active = Some(ActiveJob {
                id: job.id.clone(),
                input_path: job.request.input_path.clone(),
                output_path: job.request.output_path.clone(),
                estimated_output_bytes: job.estimated_output_bytes,
                process: None,
                process_id: None,
                paused: false,
                partial: None,
                auxiliary_partial: None,
            });
            return Ok(Some(ReservedJob::Pending(Box::new(job))));
        }

        if let Some(index) = state.suspended.iter().position(|job| job.id == job_id) {
            let process_id = state.suspended[index].process_id.ok_or_else(|| {
                ApiError::new("job_state_error", "The encoding process is unavailable.")
            })?;
            self.sleep_preventer.activate()?;
            if let Err(error) = process::set_paused(process_id, false) {
                self.sleep_preventer.deactivate();
                return Err(error);
            }

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
        let process = process::RunningProcess::from_shell(child);
        self.attach_running(job_id, process)
    }

    pub(crate) fn attach_running(
        &self,
        job_id: &str,
        process: process::RunningProcess,
    ) -> ApiResult<()> {
        let process_id = process.process_id();
        let mut state = match self.lock() {
            Ok(state) => state,
            Err(error) => {
                stop_untracked(process);
                return Err(error);
            }
        };
        if state.cancelled.contains(job_id) {
            drop(state);
            stop_untracked(process);
            return Err(ApiError::new("cancelled", "The conversion was cancelled."));
        }
        let failure = if state.active.is_none() {
            Some("The reserved encoding job is unavailable.")
        } else if state.active.as_ref().map(|job| job.id.as_str()) != Some(job_id) {
            Some("The reserved encoding job changed unexpectedly.")
        } else {
            None
        };
        if let Some(message) = failure {
            drop(state);
            stop_untracked(process);
            return Err(ApiError::new("job_state_error", message));
        }

        let active = state.active.as_mut().expect("the active job was checked");
        active.process = Some(process);
        active.process_id = Some(process_id);
        Ok(())
    }

    /// The shell has reaped the encoder. Never signal its reusable PID again.
    pub(crate) fn encoder_terminated(&self, job_id: &str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let active = if state.active.as_ref().is_some_and(|job| job.id == job_id) {
            state.active.as_mut()
        } else {
            state.suspended.iter_mut().find(|job| job.id == job_id)
        };
        if let Some(job) = active {
            job.process = None;
            job.process_id = None;
        }
    }

    pub fn finish_active(&self, job_id: &str) -> ApiResult<()> {
        let mut state = self.lock()?;
        if state.active.as_ref().map(|job| job.id.as_str()) == Some(job_id) {
            state.active.take();
            self.sleep_preventer.deactivate();
        } else if let Some(index) = state.suspended.iter().position(|job| job.id == job_id) {
            state.suspended.remove(index);
            state.waiting_order.retain(|id| id != job_id);
        }
        // Publication may already have crossed its cancellation boundary.
        // Do not retain a late cancellation after the job has become terminal.
        state.cancelled.remove(job_id);
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
                ApiError::new(
                    "job_state_error",
                    "This conversion is starting or finishing and cannot be paused yet.",
                )
            })?;
            process::set_paused(process_id, true)?;

            let mut active = state.active.take().expect("the active job was checked");
            active.paused = true;
            state.suspended.push_back(active);
            state.waiting_order.push_front(job_id.to_owned());
            self.sleep_preventer.deactivate();
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
        self.sleep_preventer.activate()?;
        if let Err(error) = process::set_paused(process_id, false) {
            self.sleep_preventer.deactivate();
            return Err(error);
        }

        let mut resumed = state
            .suspended
            .remove(index)
            .expect("the suspended job was located");
        resumed.paused = false;
        state.waiting_order.pop_front();
        state.active = Some(resumed);
        Ok(())
    }

    /// Marks a reserved job as preparing segment files so cancel can stop it
    /// before the encoder is attached.
    pub(crate) fn begin_preparation(&self, job_id: &str) -> ApiResult<()> {
        let mut state = self.lock()?;
        let active = state.active.as_ref().ok_or_else(|| {
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
        state.preparing_job = Some(job_id.to_owned());
        Ok(())
    }

    pub(crate) fn end_preparation(&self, job_id: &str) {
        let process = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(poisoned) => poisoned.into_inner(),
            };
            if state.preparing_job.as_deref() != Some(job_id) {
                return;
            }
            state.preparing_job = None;
            state.preparing_process.take()
        };
        if let Some(process) = process {
            let _ = process.stop();
        }
    }

    pub(crate) fn attach_preparing(
        &self,
        job_id: &str,
        process: process::RunningProcess,
    ) -> ApiResult<()> {
        let mut state = self.lock()?;
        if state.cancelled.contains(job_id) {
            drop(state);
            let _ = process.stop();
            return Err(ApiError::new("cancelled", "The conversion was cancelled."));
        }
        if state.preparing_job.as_deref() != Some(job_id) {
            drop(state);
            let _ = process.stop();
            return Err(ApiError::new(
                "job_state_error",
                "The reserved encoding job is unavailable.",
            ));
        }
        if let Some(previous) = state.preparing_process.replace(process) {
            drop(state);
            let _ = previous.stop();
        }
        Ok(())
    }

    pub(crate) fn take_preparing_process(&self, job_id: &str) -> Option<process::RunningProcess> {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(poisoned) => poisoned.into_inner(),
        };
        if state.preparing_job.as_deref() != Some(job_id) {
            return None;
        }
        state.preparing_process.take()
    }

    pub(crate) fn is_cancelled(&self, job_id: &str) -> bool {
        self.state
            .lock()
            .map(|state| state.cancelled.contains(job_id))
            .unwrap_or(false)
    }

    pub fn cancel(&self, job_id: &str) -> ApiResult<CancelledJob> {
        let mut state = self.lock()?;

        if state.active.as_ref().map(|job| job.id.as_str()) == Some(job_id) {
            if state.preparing_job.as_deref() == Some(job_id) {
                state.preparing_job = None;
                state.cancelled.insert(job_id.to_owned());
                return match state.preparing_process.take() {
                    Some(process) => Ok(CancelledJob::Active { process }),
                    None => Ok(CancelledJob::Preparing),
                };
            }
            let active = state.active.as_mut().expect("the active job was checked");
            if active.process_id.is_none() {
                state.cancelled.insert(job_id.to_owned());
                return Ok(CancelledJob::Preparing);
            }
            let process = active.process.take().ok_or_else(|| {
                ApiError::new("job_state_error", "The encoding process is still starting.")
            })?;
            state.cancelled.insert(job_id.to_owned());
            return Ok(CancelledJob::Active { process });
        }

        if let Some(index) = state.suspended.iter().position(|job| job.id == job_id) {
            let process = {
                let suspended = state
                    .suspended
                    .get_mut(index)
                    .expect("the suspended job was located");
                if suspended.process_id.is_none() {
                    return Err(ApiError::new(
                        "job_state_error",
                        "The encoding process is unavailable.",
                    ));
                }
                suspended.process.take().ok_or_else(|| {
                    ApiError::new("job_state_error", "The encoding process is unavailable.")
                })?
            };
            state.suspended.remove(index);
            state.waiting_order.retain(|id| id != job_id);
            state.cancelled.insert(job_id.to_owned());
            return Ok(CancelledJob::Active { process });
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

    pub fn begin_update(&self) -> ApiResult<UpdateGuard<'_>> {
        let mut state = self.lock()?;
        if state.update_in_progress {
            return Err(ApiError::new(
                "update_in_progress",
                "An application update is already in progress.",
            ));
        }
        if state.active.is_some() || !state.suspended.is_empty() || !state.pending.is_empty() {
            return Err(ApiError::new(
                "conversion_in_progress",
                "Finish or cancel every queued conversion before installing an update.",
            ));
        }
        state.update_in_progress = true;
        Ok(UpdateGuard { manager: self })
    }

    pub fn take_cancelled(&self, job_id: &str) -> bool {
        // A poisoned lock still records the cancellation. Dropping that flag
        // would let a successful exit publish the output after the user cancelled.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .cancelled
            .remove(job_id)
    }

    pub fn shutdown(&self) {
        // A poisoned lock still holds the running encoders. Leaving them
        // running would keep writing a partial file after the application
        // exits. `reserved_output_paths` recovers the same lock.
        let (running, preparing) = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut running = state.active.take().into_iter().collect::<Vec<_>>();
            running.extend(state.suspended.drain(..));
            let preparing = state.preparing_process.take();
            state.preparing_job = None;
            state.pending.clear();
            state.waiting_order.clear();
            state.cancelled.clear();
            state.update_in_progress = false;
            (running, preparing)
        };
        if let Some(process) = preparing {
            if let Err(error) = process.stop() {
                eprintln!("Unable to stop FFmpeg during shutdown: {error}");
            }
        }

        for mut job in running {
            if let Some(process) = job.process.take() {
                if let Err(error) = process.stop() {
                    eprintln!("Unable to stop FFmpeg during shutdown: {error}");
                }
            }
            // The destination is published only after success. Shutdown may
            // remove the partial file and must leave that destination alone.
            for partial in job
                .partial
                .take()
                .into_iter()
                .chain(job.auxiliary_partial.take())
            {
                discard_partial(&partial);
            }
        }
        self.sleep_preventer.deactivate();
    }

    fn lock(&self) -> ApiResult<std::sync::MutexGuard<'_, JobState>> {
        self.state
            .lock()
            .map_err(|_| ApiError::new("job_state_error", "Unable to access the job queue."))
    }
}

fn paths_overlap(left: &str, right: &str) -> ApiResult<bool> {
    Ok(left == right || same_existing_file(Path::new(left), Path::new(right))?)
}

fn stop_untracked(process: process::RunningProcess) {
    // Dropping the handle leaves FFmpeg running. Stop it before the queue
    // forgets the process, or the partial file keeps growing with no owner.
    if let Err(error) = process.stop() {
        eprintln!("Unable to stop FFmpeg after it could not be tracked: {error}");
    }
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map_or(0, |metadata| metadata.len())
}

#[cfg(test)]
mod tests;
