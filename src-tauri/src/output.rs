use crate::error::{ApiError, ApiResult};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn reveal(path: &str) -> ApiResult<()> {
    let output = validate(path)?;
    reveal_on_platform(&output)
}

pub fn destination_files(directory: &str) -> ApiResult<Vec<String>> {
    let folder = Path::new(directory);
    if !folder.is_absolute() {
        return Err(ApiError::invalid_input(
            "The destination folder path must be absolute.",
        ));
    }
    if !folder.is_dir() {
        return Err(ApiError::invalid_input(
            "The destination folder does not exist or is not accessible.",
        ));
    }

    let entries = fs::read_dir(folder).map_err(|error| {
        ApiError::new(
            "destination_read_error",
            format!("The destination folder could not be read: {error}"),
        )
    })?;
    Ok(entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect())
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
    use super::{destination_files, validate};

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

    #[test]
    fn destination_files_lists_existing_names() {
        let directory = std::env::temp_dir().join(format!(
            "vidra-destination-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("the system clock should be after the Unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(directory.join("nested"))
            .expect("the test directory should be created");
        std::fs::write(directory.join("holiday-vidra.mp4"), b"earlier conversion")
            .expect("the earlier output should be written");

        let mut names = destination_files(directory.to_string_lossy().as_ref())
            .expect("an existing folder should be listed");
        names.sort();

        assert_eq!(names, vec!["holiday-vidra.mp4", "nested"]);
        std::fs::remove_dir_all(directory).expect("the test directory should be removed");
    }

    #[test]
    fn destination_files_requires_an_existing_folder() {
        let error = destination_files("destination").unwrap_err();
        assert_eq!(error.code, "invalid_input");

        let missing =
            std::env::temp_dir().join(format!("vidra-missing-destination-{}", std::process::id()));
        let error = destination_files(missing.to_string_lossy().as_ref()).unwrap_err();
        assert_eq!(error.code, "invalid_input");
    }
}
