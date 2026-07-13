use crate::error::{ApiError, ApiResult};
use std::path::Path;

#[cfg(target_os = "macos")]
pub fn reveal(path: &Path) -> ApiResult<()> {
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|error| ApiError::new("reveal_error", error.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(ApiError::new(
            "reveal_error",
            "Unable to show the output file in Finder.",
        ))
    }
}

#[cfg(not(target_os = "macos"))]
pub fn reveal(_path: &Path) -> ApiResult<()> {
    Err(ApiError::new(
        "unsupported_platform",
        "Showing an output file is not supported on this platform yet.",
    ))
}
