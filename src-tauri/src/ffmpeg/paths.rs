use super::OutputContainer;
use crate::error::{ApiError, ApiResult};
use std::{
    fs,
    path::{Path, PathBuf},
};

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
    inputs: &[PathBuf],
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
    let canonical_parent = parent.canonicalize().map_err(|_| {
        ApiError::invalid_input("The output directory does not exist or is not accessible.")
    })?;
    if !canonical_parent.is_dir() {
        return Err(ApiError::invalid_input(
            "The output directory is not a folder.",
        ));
    }

    let file_name = output
        .file_name()
        .ok_or_else(|| ApiError::invalid_input("The output filename is invalid."))?;
    let normalized_output = canonical_parent.join(file_name);

    if let Ok(metadata) = fs::symlink_metadata(&normalized_output) {
        if metadata.file_type().is_symlink() {
            return Err(ApiError::invalid_input(
                "The output file cannot be a symbolic link.",
            ));
        }
        if !metadata.is_file() {
            return Err(ApiError::invalid_input(
                "The selected output is not a regular file.",
            ));
        }
    }

    if inputs
        .iter()
        .any(|input| normalized_output == *input || same_existing_file(&normalized_output, input))
    {
        return Err(ApiError::invalid_input(
            "The output file must be different from every input file.",
        ));
    }

    Ok(normalized_output)
}

fn same_existing_file(left: &Path, right: &Path) -> bool {
    let (Ok(left_metadata), Ok(right_metadata)) = (fs::metadata(left), fs::metadata(right)) else {
        return false;
    };
    same_file_identity(&left_metadata, &right_metadata)
}

#[cfg(unix)]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file_identity(_left: &fs::Metadata, _right: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::validate_output;
    use crate::ffmpeg::OutputContainer;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_directory(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "vidra-path-test-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("the test directory should be created");
        directory
    }

    fn path_text(path: &Path) -> &str {
        path.to_str().expect("test paths should be valid UTF-8")
    }

    #[test]
    fn normalizes_the_output_parent_and_rejects_every_input_path() {
        let directory = test_directory("multiple-inputs");
        let first = directory.join("first.mp4");
        let second = directory.join("second.mp4");
        fs::write(&first, b"first").expect("the first input should be written");
        fs::write(&second, b"second").expect("the second input should be written");
        let inputs = vec![
            first
                .canonicalize()
                .expect("the first input should resolve"),
            second
                .canonicalize()
                .expect("the second input should resolve"),
        ];

        let aliased_second = directory.join("nested").join("..").join("second.mp4");
        fs::create_dir_all(directory.join("nested")).expect("the nested directory should exist");
        let error = validate_output(path_text(&aliased_second), &inputs, OutputContainer::Mp4)
            .expect_err("an output matching any input should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("every input file"));
        fs::remove_dir_all(directory).expect("the test directory should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links_and_hard_links_to_an_input() {
        use std::os::unix::fs::symlink;

        let directory = test_directory("links");
        let input = directory.join("input.mp4");
        let symbolic_output = directory.join("symbolic.mp4");
        let hard_output = directory.join("hard.mp4");
        fs::write(&input, b"source").expect("the input should be written");
        symlink(&input, &symbolic_output).expect("the symbolic link should be created");
        fs::hard_link(&input, &hard_output).expect("the hard link should be created");
        let inputs = vec![input.canonicalize().expect("the input should resolve")];

        let symbolic_error =
            validate_output(path_text(&symbolic_output), &inputs, OutputContainer::Mp4)
                .expect_err("a symbolic-link output should be rejected");
        assert!(symbolic_error.message.contains("symbolic link"));

        let hard_error = validate_output(path_text(&hard_output), &inputs, OutputContainer::Mp4)
            .expect_err("a hard-link output matching an input should be rejected");
        assert!(hard_error.message.contains("every input file"));
        fs::remove_dir_all(directory).expect("the test directory should be removed");
    }
}
