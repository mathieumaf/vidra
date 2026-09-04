use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Url};

/// Video extensions Vidra can open from the operating system.
///
/// Keep this list in sync with `supportedExtensions` in
/// `src/hooks/useEncodingQueue.ts` and with `fileAssociations` in
/// `src-tauri/tauri.conf.json`.
pub const SUPPORTED_VIDEO_EXTENSIONS: &[&str] =
    &["mp4", "mov", "mkv", "webm", "avi", "m4v", "mts", "m2ts"];

/// Files opened from the operating system (Finder, second launch) that the
/// interface has not collected yet.
///
/// Paths are stored here because the interface may not be listening when the
/// operating system delivers them, typically on a cold start. The interface
/// drains them once through `take_opened_files` and then relies on the
/// `open-files` event for files opened while it is running.
#[derive(Default)]
pub struct OpenedFiles(Mutex<Vec<PathBuf>>);

impl OpenedFiles {
    pub(crate) fn push(&self, paths: Vec<PathBuf>) {
        if paths.is_empty() {
            return;
        }
        self.0
            .lock()
            .expect("opened files lock poisoned")
            .extend(paths);
    }

    fn take(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.0.lock().expect("opened files lock poisoned"))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilesPayload {
    pub paths: Vec<String>,
}

pub fn is_supported_video_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_VIDEO_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

/// Keep process arguments that point at supported video files.
///
/// Launch arguments also contain the executable path and may contain flags,
/// so everything without a supported video extension is ignored. Existence is
/// checked later by the probe path, which already reports unreadable files.
pub fn paths_from_args(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .map(PathBuf::from)
        .filter(|path| is_supported_video_path(path))
        .collect()
}

/// Keep file URLs delivered by the operating system that point at supported
/// video files. Non-file URLs are ignored.
pub fn paths_from_urls(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| is_supported_video_path(path))
        .collect()
}

/// Store opened files for a later `take_opened_files` call and notify a
/// running interface through the `open-files` event.
pub fn store_and_emit(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<OpenedFiles>() {
        state.push(paths.clone());
    }
    let _ = app.emit(
        "open-files",
        OpenFilesPayload {
            paths: paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        },
    );
}

/// Collect files opened from the operating system that the interface has not
/// seen yet. Each path is returned at most once.
#[tauri::command]
pub fn take_opened_files(state: State<'_, OpenedFiles>) -> Vec<String> {
    drain_to_strings(&state)
}

fn drain_to_strings(state: &OpenedFiles) -> Vec<String> {
    state
        .take()
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{is_supported_video_path, paths_from_args, paths_from_urls, OpenedFiles, Url};
    use std::path::PathBuf;

    #[test]
    fn supported_extensions_match_case_insensitively() {
        assert!(is_supported_video_path(
            PathBuf::from("/tmp/clip.MP4").as_path()
        ));
        assert!(is_supported_video_path(
            PathBuf::from("/tmp/clip.Mkv").as_path()
        ));
        assert!(!is_supported_video_path(
            PathBuf::from("/tmp/clip.srt").as_path()
        ));
        assert!(!is_supported_video_path(
            PathBuf::from("/tmp/clip").as_path()
        ));
    }

    #[test]
    fn launch_arguments_keep_only_supported_video_files() {
        let args = vec![
            "/Applications/Vidra.app/Contents/MacOS/Vidra".to_owned(),
            "/tmp/holiday.MOV".to_owned(),
            "--some-flag".to_owned(),
            "/tmp/notes.txt".to_owned(),
        ];

        assert_eq!(
            paths_from_args(&args),
            vec![PathBuf::from("/tmp/holiday.MOV")]
        );
    }

    #[test]
    fn opened_urls_keep_only_supported_files() {
        let urls = [
            Url::parse("file:///tmp/holiday.mp4").unwrap(),
            Url::parse("file:///tmp/song.mp3").unwrap(),
            Url::parse("https://example.com/clip.mp4").unwrap(),
        ];

        assert_eq!(
            paths_from_urls(&urls),
            vec![PathBuf::from("/tmp/holiday.mp4")]
        );
    }

    #[test]
    fn stored_files_are_returned_exactly_once() {
        let state = OpenedFiles::default();
        state.push(vec![PathBuf::from("/tmp/a.mp4")]);
        state.push(vec![PathBuf::from("/tmp/b.mkv")]);

        assert_eq!(
            super::drain_to_strings(&state),
            vec!["/tmp/a.mp4", "/tmp/b.mkv"]
        );
        assert!(super::drain_to_strings(&state).is_empty());
    }
}
