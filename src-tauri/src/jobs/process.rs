use crate::error::{ApiError, ApiResult};

#[cfg(unix)]
pub fn set_paused(process_id: u32, paused: bool) -> ApiResult<()> {
    let signal = if paused { libc::SIGSTOP } else { libc::SIGCONT };
    // SAFETY: `kill` only sends a signal to the FFmpeg PID returned by the spawned child process.
    let result = unsafe { libc::kill(process_id as libc::pid_t, signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(ApiError::ffmpeg(format!(
            "Unable to {} FFmpeg: {}",
            if paused { "pause" } else { "resume" },
            std::io::Error::last_os_error()
        )))
    }
}

#[cfg(not(unix))]
pub fn set_paused(_process_id: u32, _paused: bool) -> ApiResult<()> {
    Err(ApiError::new(
        "pause_unsupported",
        "Pausing an encoding job is not supported on this platform yet.",
    ))
}
