use super::FfmpegStatus;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub(super) async fn version(app: &AppHandle, binary: &str) -> Result<String, String> {
    let command = app
        .shell()
        .sidecar(binary)
        .map_err(|error| error.to_string())?;
    let output = command
        .arg("-version")
        .output()
        .await
        .map_err(|error| error.to_string())?;

    parse_version_output(
        binary,
        output.status.success(),
        &output.stdout,
        &output.stderr,
    )
}

fn parse_version_output(
    binary: &str,
    success: bool,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<String, String> {
    if !success {
        return Err(String::from_utf8_lossy(stderr).trim().to_owned());
    }

    String::from_utf8_lossy(stdout)
        .lines()
        .next()
        .map(str::to_owned)
        .ok_or_else(|| format!("{binary} returned no version information."))
}

fn status_from_versions(
    ffmpeg: Result<String, String>,
    ffprobe: Result<String, String>,
) -> FfmpegStatus {
    match (ffmpeg, ffprobe) {
        (Ok(ffmpeg_version), Ok(ffprobe_version)) => FfmpegStatus {
            ready: true,
            ffmpeg_version: Some(ffmpeg_version),
            ffprobe_version: Some(ffprobe_version),
            error: None,
        },
        (ffmpeg, ffprobe) => {
            let error = ffmpeg.err().or_else(|| ffprobe.err());
            FfmpegStatus {
                ready: false,
                ffmpeg_version: None,
                ffprobe_version: None,
                error,
            }
        }
    }
}

pub async fn status(app: &AppHandle) -> FfmpegStatus {
    status_from_versions(version(app, "ffmpeg").await, version(app, "ffprobe").await)
}

#[cfg(test)]
mod tests {
    use super::{parse_version_output, status_from_versions};

    #[test]
    fn version_output_keeps_the_first_line() {
        let version = parse_version_output(
            "ffmpeg",
            true,
            b"ffmpeg version n7.1 Copyright (c) 2000-2024\nbuilt with gcc\n",
            b"ignored on success\n",
        )
        .unwrap();

        assert_eq!(version, "ffmpeg version n7.1 Copyright (c) 2000-2024");
    }

    #[test]
    fn missing_version_output_names_the_binary() {
        let error = parse_version_output("ffprobe", true, b"", b"unused").unwrap_err();
        assert_eq!(error, "ffprobe returned no version information.");
    }

    #[test]
    fn failed_version_output_uses_trimmed_stderr() {
        let error = parse_version_output(
            "ffmpeg",
            false,
            b"ffmpeg version should be ignored\n",
            b"  sidecar failed \n",
        )
        .unwrap_err();

        assert_eq!(error, "sidecar failed");
    }

    #[test]
    fn status_is_ready_only_when_both_versions_are_present() {
        let ready = status_from_versions(
            Ok("ffmpeg version 1".to_owned()),
            Ok("ffprobe version 1".to_owned()),
        );
        assert!(ready.ready);
        assert_eq!(ready.ffmpeg_version.as_deref(), Some("ffmpeg version 1"));
        assert_eq!(ready.ffprobe_version.as_deref(), Some("ffprobe version 1"));
        assert!(ready.error.is_none());

        let ffmpeg_failed = status_from_versions(
            Err("ffmpeg missing".to_owned()),
            Ok("ffprobe version 1".to_owned()),
        );
        assert!(!ffmpeg_failed.ready);
        assert!(ffmpeg_failed.ffmpeg_version.is_none());
        assert!(ffmpeg_failed.ffprobe_version.is_none());
        assert_eq!(ffmpeg_failed.error.as_deref(), Some("ffmpeg missing"));

        let probe_failed = status_from_versions(
            Ok("ffmpeg version 1".to_owned()),
            Err("ffprobe missing".to_owned()),
        );
        assert!(!probe_failed.ready);
        assert_eq!(probe_failed.error.as_deref(), Some("ffprobe missing"));
    }
}
