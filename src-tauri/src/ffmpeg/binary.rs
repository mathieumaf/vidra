use super::FfmpegStatus;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

async fn version(app: &AppHandle, binary: &str) -> Result<String, String> {
    let command = app
        .shell()
        .sidecar(binary)
        .map_err(|error| error.to_string())?;
    let output = command
        .arg("-version")
        .output()
        .await
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::to_owned)
        .ok_or_else(|| format!("{binary} returned no version information."))
}

pub async fn status(app: &AppHandle) -> FfmpegStatus {
    let ffmpeg = version(app, "ffmpeg").await;
    let ffprobe = version(app, "ffprobe").await;

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
