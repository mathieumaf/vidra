use super::OutputContainer;
use crate::error::{ApiError, ApiResult};
use std::path::{Path, PathBuf};

pub(super) fn validate_input(path: &str) -> ApiResult<PathBuf> {
    let input = Path::new(path);
    if !input.is_absolute() {
        return Err(ApiError::invalid_input("The input path must be absolute."));
    }

    let canonical = input
        .canonicalize()
        .map_err(|_| ApiError::invalid_input("The selected input file is not accessible."))?;

    if !canonical.is_file() {
        return Err(ApiError::invalid_input("The selected input is not a file."));
    }

    Ok(canonical)
}

pub(super) fn validate_output(
    path: &str,
    input: &Path,
    container: OutputContainer,
) -> ApiResult<PathBuf> {
    let output = PathBuf::from(path);
    if !output.is_absolute() {
        return Err(ApiError::invalid_input("The output path must be absolute."));
    }

    let extension_matches = output
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(container.extension()));

    if !extension_matches {
        return Err(ApiError::invalid_input(format!(
            "The selected container requires a .{} output.",
            container.extension()
        )));
    }

    let parent = output
        .parent()
        .ok_or_else(|| ApiError::invalid_input("The output directory is invalid."))?;

    if !parent.is_dir() {
        return Err(ApiError::invalid_input(
            "The output directory does not exist.",
        ));
    }

    if output == input {
        return Err(ApiError::invalid_input(
            "The output file must be different from the input file.",
        ));
    }

    Ok(output)
}
