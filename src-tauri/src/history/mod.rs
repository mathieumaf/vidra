mod manager;
#[cfg(test)]
mod tests;
mod types;

pub use manager::{now_millis, HistoryManager};
pub use types::{HistoryDraft, HistoryEntry, HistoryStatus};

use crate::error::{ApiError, ApiResult};

pub fn reveal_output(manager: &HistoryManager, id: &str) -> ApiResult<()> {
    let entry = manager.get(id)?;
    if entry.status != HistoryStatus::Completed {
        return Err(ApiError::invalid_input(
            "Only completed conversion outputs can be shown.",
        ));
    }
    crate::output::reveal(&entry.output_path)
}
