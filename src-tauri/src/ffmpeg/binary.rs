use super::version::{assess_engine, development_override_marker_name, host_target_triple};
use super::FfmpegStatus;
#[cfg(debug_assertions)]
use std::path::Path;
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
        (Ok(ffmpeg_version), Ok(ffprobe_version)) => assess_engine(
            &ffmpeg_version,
            &ffprobe_version,
            development_override_active(),
        ),
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

fn development_override_active() -> bool {
    let name = development_override_marker_name(host_target_triple());
    // A packaged release has no source tree. Only debug builds may find the
    // override marker under the Cargo manifest directory.
    #[cfg(debug_assertions)]
    if debug_manifest_override_marker(&name) {
        return true;
    }

    std::env::current_exe()
        .ok()
        .and_then(|executable| executable.parent().map(|directory| directory.join(&name)))
        .is_some_and(|path| path.is_file())
}

#[cfg(debug_assertions)]
fn debug_manifest_override_marker(name: &str) -> bool {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(name)
        .is_file()
}
