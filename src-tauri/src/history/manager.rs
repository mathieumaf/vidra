use super::{HistoryDraft, HistoryEntry, HistoryStatus};
use crate::error::{ApiError, ApiResult};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const HISTORY_VERSION: u32 = 1;
pub const MAX_HISTORY_ENTRIES: usize = 200;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    version: u32,
    entries: Vec<HistoryEntry>,
}

pub struct HistoryManager {
    path: PathBuf,
    entries: Mutex<Vec<HistoryEntry>>,
    next_id: AtomicU64,
}

impl HistoryManager {
    pub fn new(path: PathBuf) -> Self {
        let entries = load_entries(&path);
        Self {
            path,
            entries: Mutex::new(entries),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn list(&self) -> ApiResult<Vec<HistoryEntry>> {
        Ok(self.lock()?.clone())
    }

    pub fn record(
        &self,
        draft: HistoryDraft,
        status: HistoryStatus,
        error: Option<&str>,
    ) -> ApiResult<HistoryEntry> {
        let finished_at_ms = now_millis();
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed);
        let output_size_bytes = (status == HistoryStatus::Completed)
            .then(|| {
                fs::metadata(&draft.output_path)
                    .ok()
                    .map(|metadata| metadata.len())
            })
            .flatten();
        let entry = HistoryEntry {
            id: format!(
                "conversion-{finished_at_ms}-{}-{}-{sequence}",
                std::process::id(),
                draft.job_id
            ),
            source_path: draft.source_path,
            source_name: draft.source_name,
            output_path: draft.output_path,
            status,
            started_at_ms: draft.started_at_ms,
            finished_at_ms,
            media_duration_seconds: draft.media_duration_seconds,
            source_size_bytes: draft.source_size_bytes,
            output_size_bytes,
            settings: draft.settings,
            error: concise_error(error),
        };

        let mut entries = self.lock()?;
        let mut updated = entries.clone();
        updated.insert(0, entry.clone());
        updated.truncate(MAX_HISTORY_ENTRIES);
        persist_entries(&self.path, &updated)?;
        *entries = updated;
        Ok(entry)
    }

    pub fn delete(&self, id: &str) -> ApiResult<()> {
        let mut entries = self.lock()?;
        let mut updated = entries.clone();
        updated.retain(|entry| entry.id != id);
        if updated.len() == entries.len() {
            return Err(ApiError::invalid_input(
                "The requested history entry does not exist.",
            ));
        }
        persist_entries(&self.path, &updated)?;
        *entries = updated;
        Ok(())
    }

    pub fn clear(&self) -> ApiResult<()> {
        let mut entries = self.lock()?;
        persist_entries(&self.path, &[])?;
        entries.clear();
        Ok(())
    }

    pub fn get(&self, id: &str) -> ApiResult<HistoryEntry> {
        self.lock()?
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
            .ok_or_else(|| ApiError::invalid_input("The requested history entry does not exist."))
    }

    fn lock(&self) -> ApiResult<MutexGuard<'_, Vec<HistoryEntry>>> {
        self.entries.lock().map_err(|_| {
            ApiError::new(
                "history_state_error",
                "Unable to access conversion history.",
            )
        })
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn concise_error(error: Option<&str>) -> Option<String> {
    let mut lines = error?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }
    if lines.len() > 2 {
        lines = lines.split_off(lines.len() - 2);
    }
    let summary = lines.join(" ");
    let mut characters = summary.chars();
    let shortened = characters.by_ref().take(500).collect::<String>();
    Some(if characters.next().is_some() {
        format!("{shortened}…")
    } else {
        shortened
    })
}

fn load_entries(path: &Path) -> Vec<HistoryEntry> {
    let Ok(contents) = fs::read(path) else {
        return Vec::new();
    };
    let Ok(mut history) = serde_json::from_slice::<HistoryFile>(&contents) else {
        return Vec::new();
    };
    if history.version != HISTORY_VERSION {
        return Vec::new();
    }
    history
        .entries
        .sort_by_key(|entry| std::cmp::Reverse(entry.finished_at_ms));
    history.entries.truncate(MAX_HISTORY_ENTRIES);
    history.entries
}

fn persist_entries(path: &Path, entries: &[HistoryEntry]) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(history_io_error)?;
    }
    let contents = serde_json::to_vec_pretty(&HistoryFile {
        version: HISTORY_VERSION,
        entries: entries.to_vec(),
    })
    .map_err(|error| ApiError::new("history_serialization_error", error.to_string()))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, contents).map_err(history_io_error)?;
    replace_file(&temporary_path, path).map_err(history_io_error)
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(source, destination)
}

fn history_io_error(error: std::io::Error) -> ApiError {
    ApiError::new(
        "history_io_error",
        format!("Unable to update conversion history: {error}"),
    )
}
