mod manager;
mod platform;
#[cfg(test)]
mod tests;
mod types;

pub use manager::{now_millis, HistoryManager};
pub use types::{HistoryDraft, HistoryEntry, HistoryStatus};

use crate::error::{ApiError, ApiResult};
use std::path::Path;

pub fn reveal_output(manager: &HistoryManager, id: &str) -> ApiResult<()> {
    let entry = manager.get(id)?;
    if entry.status != HistoryStatus::Completed {
        return Err(ApiError::invalid_input(
            "Only completed conversion outputs can be shown.",
        ));
    }
    let output = Path::new(&entry.output_path);
    if !output.is_file() {
        return Err(ApiError::new(
            "output_not_found",
            "The output file is no longer available at its original location.",
        ));
    }
    platform::reveal(output)
}
