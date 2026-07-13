use crate::error::{ApiError, ApiResult};
use std::path::{Path, PathBuf};

pub fn reveal(path: &str) -> ApiResult<()> {
    let output = validate(path)?;
    reveal_on_platform(&output)
}

fn validate(path: &str) -> ApiResult<PathBuf> {
    let output = Path::new(path);
    if !output.is_absolute() {
        return Err(ApiError::invalid_input("The output path must be absolute."));
    }
    if !output.is_file() {
        return Err(ApiError::new(
            "output_not_found",
            "The output file is no longer available at its original location.",
        ));
    }
    Ok(output.to_path_buf())
}

#[cfg(target_os = "macos")]
fn reveal_on_platform(path: &Path) -> ApiResult<()> {
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
fn reveal_on_platform(_path: &Path) -> ApiResult<()> {
    Err(ApiError::new(
        "unsupported_platform",
        "Showing an output file is not supported on this platform yet.",
    ))
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn reveal_requires_an_absolute_path() {
        let error = validate("output.mp4").unwrap_err();

        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn reveal_requires_an_existing_file() {
        let path = std::env::temp_dir().join(format!(
            "vidra-missing-output-{}-{}.mp4",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let error = validate(path.to_string_lossy().as_ref()).unwrap_err();

        assert_eq!(error.code, "output_not_found");
    }
}
