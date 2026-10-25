use crate::error::{ApiError, ApiResult};
use tauri_plugin_shell::process::CommandChild;

#[cfg(unix)]
fn signal_process(process_id: u32, signal: libc::c_int) -> std::io::Result<()> {
    // SAFETY: `kill` only reads the PID and signal values passed by the caller.
    let result = unsafe { libc::kill(process_id as libc::pid_t, signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(unix)]
pub fn set_paused(process_id: u32, paused: bool) -> ApiResult<()> {
    let signal = if paused { libc::SIGSTOP } else { libc::SIGCONT };
    signal_process(process_id, signal).map_err(|error| {
        ApiError::ffmpeg(format!(
            "Unable to {} FFmpeg: {error}",
            if paused { "pause" } else { "resume" }
        ))
    })
}

#[cfg(not(unix))]
pub fn set_paused(_process_id: u32, _paused: bool) -> ApiResult<()> {
    Err(ApiError::new(
        "pause_unsupported",
        "Pausing an encoding job is not supported on this platform yet.",
    ))
}

#[cfg(unix)]
fn terminate_process(process_id: u32) -> ApiResult<()> {
    match signal_process(process_id, libc::SIGKILL) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => Ok(()),
        Err(error) => Err(ApiError::ffmpeg(format!(
            "Unable to cancel FFmpeg: {error}"
        ))),
    }
}

#[cfg(unix)]
pub fn terminate(process_id: u32, _child: CommandChild) -> ApiResult<()> {
    terminate_process(process_id)
}

#[cfg(not(unix))]
pub fn terminate(_process_id: u32, child: CommandChild) -> ApiResult<()> {
    child
        .kill()
        .map_err(|error| ApiError::ffmpeg(format!("Unable to cancel FFmpeg: {error}")))
}

/// A running encoder. Pausing uses the cached PID. Stopping owns the shell
/// child and is explicit: dropping this handle does not signal the process,
/// matching the previous `CommandChild` handle.
pub(crate) struct RunningProcess {
    process_id: u32,
    stop: Option<Box<dyn FnOnce() -> ApiResult<()> + Send>>,
}

impl RunningProcess {
    pub(crate) fn from_shell(child: CommandChild) -> Self {
        // Cache the PID before FFmpeg can be suspended. On macOS, querying the
        // shell child after SIGSTOP can block behind its internal wait lock.
        let process_id = child.pid();
        Self::from_stop(process_id, move || terminate(process_id, child))
    }

    pub(crate) fn from_stop(
        process_id: u32,
        stop: impl FnOnce() -> ApiResult<()> + Send + 'static,
    ) -> Self {
        Self {
            process_id,
            stop: Some(Box::new(stop)),
        }
    }

    pub(crate) fn process_id(&self) -> u32 {
        self.process_id
    }

    pub(crate) fn stop(mut self) -> ApiResult<()> {
        if let Some(stop) = self.stop.take() {
            stop()
        } else {
            Ok(())
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{set_paused, terminate_process};
    use std::os::unix::process::ExitStatusExt;
    use std::process::{Child, Command};

    fn missing_process_id() -> u32 {
        let pid_max = std::fs::read_to_string("/proc/sys/kernel/pid_max")
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
            .unwrap_or(4_194_304);
        pid_max.saturating_add(1).min(i32::MAX as u32)
    }

    struct ChildGuard(Child);

    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn cached_process_id_can_pause_and_resume_a_child() {
        let child = Command::new("sleep").arg("30").spawn().unwrap();
        let mut child = ChildGuard(child);
        let process_id = child.0.id();

        set_paused(process_id, true).unwrap();
        let mut status = 0;
        // SAFETY: the PID belongs to the child spawned by this test.
        let waited =
            unsafe { libc::waitpid(process_id as libc::pid_t, &mut status, libc::WUNTRACED) };
        assert_eq!(waited, process_id as libc::pid_t);
        assert!(libc::WIFSTOPPED(status));

        set_paused(process_id, false).unwrap();
        let mut status = 0;
        // SAFETY: the PID still belongs to the unreaped child.
        let waited =
            unsafe { libc::waitpid(process_id as libc::pid_t, &mut status, libc::WCONTINUED) };
        assert_eq!(waited, process_id as libc::pid_t);
        assert!(libc::WIFCONTINUED(status));

        child.0.kill().unwrap();
        child.0.wait().unwrap();
    }

    #[test]
    fn terminate_kills_a_child_and_ignores_a_process_that_is_already_gone() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let process_id = child.id();

        terminate_process(process_id).unwrap();
        let status = child.wait().unwrap();
        assert!(!status.success());
        assert_eq!(status.code(), None);
        assert_eq!(status.signal(), Some(libc::SIGKILL));

        terminate_process(process_id).unwrap();
    }

    #[test]
    fn pausing_an_unknown_process_reports_ffmpeg_error() {
        let process_id = missing_process_id();
        let error = set_paused(process_id, true).unwrap_err();
        assert_eq!(error.code, "ffmpeg_error");
        assert!(error.message.contains("pause"));

        let error = set_paused(process_id, false).unwrap_err();
        assert_eq!(error.code, "ffmpeg_error");
        assert!(error.message.contains("resume"));
    }
}
