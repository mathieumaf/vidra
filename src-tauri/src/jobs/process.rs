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
pub fn terminate(process_id: u32, _child: CommandChild) -> ApiResult<()> {
    match signal_process(process_id, libc::SIGKILL) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => Ok(()),
        Err(error) => Err(ApiError::ffmpeg(format!(
            "Unable to cancel FFmpeg: {error}"
        ))),
    }
}

#[cfg(not(unix))]
pub fn terminate(_process_id: u32, child: CommandChild) -> ApiResult<()> {
    child
        .kill()
        .map_err(|error| ApiError::ffmpeg(format!("Unable to cancel FFmpeg: {error}")))
}

#[cfg(all(test, unix))]
mod tests {
    use super::set_paused;
    use std::process::{Child, Command};

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
}
