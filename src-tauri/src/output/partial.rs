use crate::error::{ApiError, ApiResult};
use crate::ffmpeg::paths::{same_existing_file, ExistingOutput};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const PARTIAL_PREFIX: &str = ".vidra-partial-";
const PARTIAL_LIST_VERSION: u32 = 1;
const MAX_CREATE_ATTEMPTS: usize = 32;
const MAX_NUMBERED_NAMES: u32 = 99;
const COULD_NOT_SAVE: &str = "The finished video could not be saved in the destination folder, so nothing already there was changed.";
const LEFT_UNCHANGED: &str =
    "The finished video could not be saved safely, so the existing file was left unchanged.";
const READ_ONLY_FOLDER: &str =
    "The destination folder is read-only, so the conversion could not be started.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DestinationIdentity {
    pub device: u64,
    pub inode: u64,
}

/// An unfinished video Vidra owns. FFmpeg writes this sibling of the
/// destination; the destination itself is published only after success.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PartialOutput {
    pub path: PathBuf,
    pub device: u64,
    pub inode: u64,
}

impl PartialOutput {
    fn identity(&self) -> DestinationIdentity {
        DestinationIdentity {
            device: self.device,
            inode: self.inode,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutputOutcome {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PartialCleanup {
    /// The partial path is gone, or it now names a file Vidra must not delete.
    Resolved,
    /// Removal failed and should be retried from the on-disk claim.
    Retry,
}

#[derive(Debug)]
pub(crate) struct FinalizedOutput {
    pub outcome: OutputOutcome,
    pub error: Option<ApiError>,
    pub cleanup: PartialCleanup,
    pub saved_path: Option<PathBuf>,
}

pub(crate) struct FinalizeRequest<'a> {
    pub partial: &'a PartialOutput,
    pub destination: &'a Path,
    /// Present only when replacement was confirmed and this exact file existed
    /// when encoding started.
    pub replace_identity: Option<DestinationIdentity>,
    pub outcome: OutputOutcome,
    pub inputs: &'a [PathBuf],
    pub reserved: &'a [PathBuf],
}

pub(crate) fn require_supported() -> ApiResult<()> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Err(unsupported_platform())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn unsupported_platform() -> ApiError {
    ApiError::new(
        "unsupported_platform",
        "Saving a converted video is not supported on this platform yet.",
    )
}

/// Replace an existing destination only when the user confirmed replacement
/// and that file was already present when encoding started.
pub(crate) fn publish_mode(replace_existing: bool, destination: &Path) -> ExistingOutput {
    if replace_existing && existing_regular_file(destination) {
        ExistingOutput::Replace
    } else {
        ExistingOutput::Reject
    }
}

pub(crate) fn destination_identity(path: &Path) -> Option<DestinationIdentity> {
    file_identity(&fs::symlink_metadata(path).ok()?)
}

pub(crate) fn is_partial_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(PARTIAL_PREFIX) else {
        return false;
    };
    let Some((stem, extension)) = rest.rsplit_once('.') else {
        return false;
    };
    if !matches!(extension, "mp4" | "mkv") || stem.len() > 80 {
        return false;
    }
    let Some((job_id, token)) = stem.rsplit_once('-') else {
        return false;
    };
    !job_id.is_empty()
        && job_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
        && !token.is_empty()
        && token
            .chars()
            .all(|character| matches!(character, '0'..='9' | 'a'..='f'))
}

pub(crate) fn ensure_partial_target(destination: &Path, partial_output: &Path) -> ApiResult<()> {
    let safe = partial_output != destination
        && partial_output.parent().is_some()
        && partial_output.parent() == destination.parent()
        && partial_output
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(is_partial_name)
        && extensions_match(partial_output, destination);
    if safe {
        Ok(())
    } else {
        Err(ApiError::invalid_input(
            "The conversion could not be started safely.",
        ))
    }
}

pub(crate) fn create_partial(
    destination: &Path,
    job_id: &str,
    extension: &str,
    reserved: &[PathBuf],
    inputs: &[PathBuf],
) -> ApiResult<PartialOutput> {
    require_supported()?;
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        create_partial_supported(destination, job_id, extension, reserved, inputs)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (destination, job_id, extension, reserved, inputs);
        Err(unsupported_platform())
    }
}

pub(crate) fn finalize_output(request: FinalizeRequest<'_>) -> FinalizedOutput {
    if request.outcome != OutputOutcome::Completed {
        return FinalizedOutput {
            outcome: request.outcome,
            error: None,
            cleanup: discard_partial(request.partial),
            saved_path: None,
        };
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = request;
        return FinalizedOutput {
            outcome: OutputOutcome::Failed,
            error: Some(unsupported_platform()),
            cleanup: PartialCleanup::Resolved,
            saved_path: None,
        };
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    place_completed(request)
}

pub(crate) fn discard_partial(partial: &PartialOutput) -> PartialCleanup {
    match fs::symlink_metadata(&partial.path) {
        Ok(metadata) => match file_identity(&metadata) {
            Some(identity) if identity == partial.identity() => remove_owned(&partial.path),
            _ => {
                eprintln!(
                    "Left an unexpected file in place instead of removing {}.",
                    partial.path.display()
                );
                PartialCleanup::Resolved
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => PartialCleanup::Resolved,
        Err(error) => {
            eprintln!(
                "Unable to inspect the temporary video {}: {error}",
                partial.path.display()
            );
            PartialCleanup::Retry
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn create_partial_supported(
    destination: &Path,
    job_id: &str,
    extension: &str,
    reserved: &[PathBuf],
    inputs: &[PathBuf],
) -> ApiResult<PartialOutput> {
    if !destination.is_absolute() {
        return Err(ApiError::invalid_input("The output path must be absolute."));
    }
    if !matches!(extension, "mp4" | "mkv") {
        return Err(ApiError::invalid_input(
            "The selected container requires an MP4 or MKV output.",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| ApiError::invalid_input("The output directory is invalid."))?;
    if !parent.is_dir() {
        return Err(ApiError::invalid_input(
            "The output directory does not exist or is not accessible.",
        ));
    }

    let job_id = safe_job_id(job_id);
    for _ in 0..MAX_CREATE_ATTEMPTS {
        let name = format!("{PARTIAL_PREFIX}{job_id}-{:x}.{extension}", next_token());
        if !is_partial_name(&name) {
            continue;
        }
        let candidate = parent.join(name);
        if candidate_blocked(&candidate, destination, reserved, inputs) {
            continue;
        }
        match create_owned(&candidate) {
            Ok(identity) => {
                return Ok(PartialOutput {
                    path: candidate,
                    device: identity.device,
                    inode: identity.inode,
                });
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(create_error(&error)),
        }
    }

    Err(ApiError::new(
        "output_unavailable",
        "The conversion could not be started in the destination folder.",
    ))
}

fn create_error(error: &io::Error) -> ApiError {
    if error.kind() == io::ErrorKind::PermissionDenied {
        return ApiError::new("output_unavailable", READ_ONLY_FOLDER);
    }
    eprintln!("Unable to create a temporary video in the destination folder: {error}");
    ApiError::new(
        "output_unavailable",
        "The conversion could not be started in the destination folder.",
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn place_completed(request: FinalizeRequest<'_>) -> FinalizedOutput {
    if !identity_matches(request.partial) {
        return left_unchanged();
    }

    let Some(destination) = resolved_destination(request.partial, request.destination) else {
        return save_visible_beside_partial(&request);
    };

    match try_requested(&request, &destination) {
        Attempt::Saved(saved) => saved_output(saved),
        Attempt::Occupied => save_under_another_name(&request, &destination),
        Attempt::Failed(error) => {
            eprintln!("Unable to save the finished video at the requested name: {error}");
            save_under_another_name(&request, &destination)
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn save_under_another_name(request: &FinalizeRequest<'_>, destination: &Path) -> FinalizedOutput {
    for candidate in numbered_names(destination) {
        if name_blocked(&candidate, destination, request.reserved, request.inputs) {
            continue;
        }
        if !identity_matches(request.partial) {
            return left_unchanged();
        }
        match rename_exclusive(&request.partial.path, &candidate) {
            Ok(()) => {
                return saved_output(Saved {
                    path: candidate.clone(),
                    note: Some(saved_elsewhere(&candidate)),
                });
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                eprintln!(
                    "Unable to save the finished video as {}: {error}",
                    candidate.display()
                );
                break;
            }
        }
    }

    if let Some(visible) = visible_recovery_name(destination) {
        if !name_blocked(&visible, destination, request.reserved, request.inputs)
            && identity_matches(request.partial)
            && rename_exclusive(&request.partial.path, &visible).is_ok()
        {
            return saved_output(Saved {
                path: visible.clone(),
                note: Some(saved_elsewhere(&visible)),
            });
        }
    }

    retain_finished_partial(request.partial)
}

fn saved_output(saved: Saved) -> FinalizedOutput {
    FinalizedOutput {
        outcome: OutputOutcome::Completed,
        error: saved
            .note
            .map(|message| ApiError::new("output_renamed", message)),
        cleanup: PartialCleanup::Resolved,
        saved_path: Some(saved.path),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn save_visible_beside_partial(request: &FinalizeRequest<'_>) -> FinalizedOutput {
    let Some(visible) = visible_recovery_name_in(
        request.partial.path.parent(),
        request.destination,
        request
            .partial
            .path
            .extension()
            .and_then(|extension| extension.to_str()),
    ) else {
        return retain_finished_partial(request.partial);
    };
    if name_blocked(
        &visible,
        request.destination,
        request.reserved,
        request.inputs,
    ) || !identity_matches(request.partial)
        || rename_exclusive(&request.partial.path, &visible).is_err()
    {
        return retain_finished_partial(request.partial);
    }
    saved_output(Saved {
        path: visible.clone(),
        note: Some(saved_elsewhere(&visible)),
    })
}

fn visible_recovery_name_in(
    parent: Option<&Path>,
    destination: &Path,
    extension: Option<&str>,
) -> Option<PathBuf> {
    let parent = parent?;
    let stem = destination.file_stem()?.to_str()?;
    let extension = extension?;
    let name = format!("{stem}.vidra-saved-{:x}.{extension}", next_token());
    if is_partial_name(&name) {
        return None;
    }
    Some(parent.join(name))
}

/// Keep a finished encode that could not be moved. A different file at the
/// partial path is left alone and is not reported as the conversion result.
fn retain_finished_partial(partial: &PartialOutput) -> FinalizedOutput {
    if identity_matches(partial) {
        keep_partial(partial)
    } else {
        left_unchanged()
    }
}

fn left_unchanged() -> FinalizedOutput {
    FinalizedOutput {
        outcome: OutputOutcome::Failed,
        error: Some(ApiError::new("output_unavailable", LEFT_UNCHANGED)),
        cleanup: PartialCleanup::Resolved,
        saved_path: None,
    }
}

fn keep_partial(partial: &PartialOutput) -> FinalizedOutput {
    FinalizedOutput {
        outcome: OutputOutcome::Completed,
        error: Some(ApiError::new(
            "output_renamed",
            format!(
                "The finished video could not be moved into place. It is still saved at {}.",
                partial.path.display()
            ),
        )),
        cleanup: PartialCleanup::Resolved,
        saved_path: Some(partial.path.clone()),
    }
}

fn saved_elsewhere(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("another file");
    format!("The requested name was already in use, so the finished video was saved as {name}.")
}

struct Saved {
    path: PathBuf,
    note: Option<String>,
}

enum Attempt {
    Saved(Saved),
    Occupied,
    Failed(io::Error),
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn try_requested(request: &FinalizeRequest<'_>, destination: &Path) -> Attempt {
    if let Some(expected) = request.replace_identity {
        return match destination_identity(destination) {
            Some(current) if current == expected => {
                if names_source(destination, request.inputs) {
                    return Attempt::Occupied;
                }
                if !identity_matches(request.partial) {
                    return Attempt::Failed(io::Error::other("the temporary video changed"));
                }
                match fs::rename(&request.partial.path, destination) {
                    Ok(()) => Attempt::Saved(Saved {
                        path: destination.to_path_buf(),
                        note: None,
                    }),
                    Err(error) => Attempt::Failed(error),
                }
            }
            Some(_) => Attempt::Occupied,
            None => {
                if names_source(destination, request.inputs) {
                    return Attempt::Occupied;
                }
                match rename_exclusive(&request.partial.path, destination) {
                    Ok(()) => Attempt::Saved(Saved {
                        path: destination.to_path_buf(),
                        note: None,
                    }),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Attempt::Occupied,
                    Err(error) => Attempt::Failed(error),
                }
            }
        };
    }

    if fs::symlink_metadata(destination).is_ok() || names_source(destination, request.inputs) {
        return Attempt::Occupied;
    }
    match rename_exclusive(&request.partial.path, destination) {
        Ok(()) => Attempt::Saved(Saved {
            path: destination.to_path_buf(),
            note: None,
        }),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Attempt::Occupied,
        Err(error) => Attempt::Failed(error),
    }
}

fn resolved_destination(partial: &PartialOutput, destination: &Path) -> Option<PathBuf> {
    let file_name = destination.file_name()?;
    let partial_parent = partial.path.parent()?.canonicalize().ok()?;
    let destination_parent = destination.parent()?.canonicalize().ok()?;
    if partial_parent != destination_parent {
        eprintln!("{COULD_NOT_SAVE}");
        return None;
    }
    Some(destination_parent.join(file_name))
}

/// Continue the numbered names Vidra already uses for batch output.
/// `holiday-vidra.mp4` is followed by `holiday-vidra-2.mp4`.
fn numbered_names(destination: &Path) -> Vec<PathBuf> {
    let Some(parent) = destination.parent() else {
        return Vec::new();
    };
    let Some(stem) = destination.file_stem().and_then(|stem| stem.to_str()) else {
        return Vec::new();
    };
    let Some(extension) = destination
        .extension()
        .and_then(|extension| extension.to_str())
    else {
        return Vec::new();
    };
    let (base, start) = split_numeric_suffix(stem);
    let mut names = Vec::new();
    let mut suffix = start.saturating_add(1).max(2);
    while names.len() < MAX_NUMBERED_NAMES as usize
        && suffix < start.saturating_add(MAX_NUMBERED_NAMES)
    {
        let name = format!("{base}-{suffix}.{extension}");
        if !is_partial_name(&name) {
            names.push(parent.join(name));
        }
        suffix = suffix.saturating_add(1);
    }
    names
}

fn split_numeric_suffix(stem: &str) -> (&str, u32) {
    let Some((head, tail)) = stem.rsplit_once('-') else {
        return (stem, 1);
    };
    if head.is_empty() {
        return (stem, 1);
    }
    match tail.parse::<u32>() {
        Ok(value) if value >= 2 => (head, value),
        _ => (stem, 1),
    }
}

fn visible_recovery_name(destination: &Path) -> Option<PathBuf> {
    visible_recovery_name_in(
        destination.parent(),
        destination,
        destination
            .extension()
            .and_then(|extension| extension.to_str()),
    )
}

fn name_blocked(
    candidate: &Path,
    destination: &Path,
    reserved: &[PathBuf],
    inputs: &[PathBuf],
) -> bool {
    candidate == destination
        || reserved
            .iter()
            .any(|path| same_directory_name(path, candidate))
        || names_source(candidate, inputs)
        || fs::symlink_metadata(candidate).is_ok()
}

fn names_source(path: &Path, inputs: &[PathBuf]) -> bool {
    inputs
        .iter()
        .any(|input| input == path || same_existing_file(path, input).unwrap_or(true))
}

fn same_directory_name(left: &Path, right: &Path) -> bool {
    left == right
        || left
            .file_name()
            .zip(right.file_name())
            .is_some_and(|(left_name, right_name)| left_name.eq_ignore_ascii_case(right_name))
            && left.parent() == right.parent()
}

fn existing_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn identity_matches(partial: &PartialOutput) -> bool {
    fs::symlink_metadata(&partial.path)
        .ok()
        .and_then(|metadata| file_identity(&metadata))
        .is_some_and(|identity| identity == partial.identity())
}

fn file_identity(metadata: &fs::Metadata) -> Option<DestinationIdentity> {
    if !metadata.is_file() {
        return None;
    }
    unix_file_identity(metadata)
}

#[cfg(unix)]
fn unix_file_identity(metadata: &fs::Metadata) -> Option<DestinationIdentity> {
    use std::os::unix::fs::MetadataExt;
    Some(DestinationIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn unix_file_identity(_metadata: &fs::Metadata) -> Option<DestinationIdentity> {
    None
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn create_owned(path: &Path) -> io::Result<DestinationIdentity> {
    let file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let created = file
        .metadata()
        .ok()
        .and_then(|metadata| file_identity(&metadata));
    let synced = file.sync_all();
    drop(file);
    let Some(created) = created else {
        return Err(io::Error::other(
            "the temporary video could not be identified",
        ));
    };
    if let Err(error) = synced {
        remove_if_same(path, &created);
        return Err(error);
    }
    match fs::symlink_metadata(path)
        .ok()
        .and_then(|metadata| file_identity(&metadata))
    {
        Some(identity) if identity == created => Ok(identity),
        _ => {
            remove_if_same(path, &created);
            Err(io::Error::other(
                "the temporary video could not be identified",
            ))
        }
    }
}

fn remove_if_same(path: &Path, identity: &DestinationIdentity) {
    let matches = fs::symlink_metadata(path)
        .ok()
        .and_then(|metadata| file_identity(&metadata))
        .is_some_and(|current| current == *identity);
    if matches {
        let _ = fs::remove_file(path);
    }
}

fn remove_owned(path: &Path) -> PartialCleanup {
    match fs::remove_file(path) {
        Ok(()) => PartialCleanup::Resolved,
        Err(error) if error.kind() == io::ErrorKind::NotFound => PartialCleanup::Resolved,
        Err(error) => {
            eprintln!(
                "Unable to remove the temporary video {}: {error}",
                path.display()
            );
            PartialCleanup::Retry
        }
    }
}

fn candidate_blocked(
    candidate: &Path,
    destination: &Path,
    reserved: &[PathBuf],
    inputs: &[PathBuf],
) -> bool {
    candidate == destination
        || reserved.iter().any(|path| path == candidate)
        || inputs.iter().any(|path| path == candidate)
}

fn extensions_match(partial_output: &Path, destination: &Path) -> bool {
    partial_output
        .extension()
        .zip(destination.extension())
        .is_some_and(|(partial, destination)| partial.eq_ignore_ascii_case(destination))
}

fn safe_job_id(job_id: &str) -> String {
    let safe = job_id
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .take(48)
        .collect::<String>();
    if safe.is_empty() {
        "job".to_owned()
    } else {
        safe
    }
}

fn next_token() -> u64 {
    static SEQUENCE: AtomicU64 = AtomicU64::new(1);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_nanos()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    nanos.wrapping_add(sequence.wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

/// Choose how to publish when an exclusive rename is unavailable.
///
/// `renamex_np(RENAME_EXCL)` and `renameat2(RENAME_NOREPLACE)` return
/// `ENOTSUP`, `ENOSYS`, or `EINVAL` on exFAT, FAT32, SMB, and FUSE. Those
/// volumes also reject hard links, so the finished file must be renamed
/// normally after checking that the destination is absent. A file created in
/// the gap between that check and the rename can still be replaced. Callers
/// pass the check result as `destination_occupied`.
#[cfg(unix)]
fn exclusive_or_absent(
    exclusive: io::Result<()>,
    destination_occupied: bool,
    plain_rename: impl FnOnce() -> io::Result<()>,
) -> io::Result<()> {
    match exclusive {
        Ok(()) => Ok(()),
        Err(error) if unsupported_exclusive(&error) => {
            if destination_occupied {
                Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "the destination appeared before the finished video could be saved",
                ))
            } else {
                plain_rename()
            }
        }
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn unsupported_exclusive(error: &io::Error) -> bool {
    // `ENOTSUP` and `EOPNOTSUPP` are the same value on Linux, so compare them
    // individually instead of matching both in one pattern.
    error.raw_os_error().is_some_and(|code| {
        code == libc::EINVAL
            || code == libc::ENOTSUP
            || code == libc::ENOSYS
            || code == libc::EOPNOTSUPP
    })
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    let exclusive = platform_exclusive_rename(from, to);
    if exclusive.is_ok() {
        return Ok(());
    }
    let destination_occupied = fs::symlink_metadata(to).is_ok();
    exclusive_or_absent(exclusive, destination_occupied, || {
        rename_if_absent(from, to)
    })
}

/// Check, then rename. See [`exclusive_or_absent`] for the race this leaves open.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_if_absent(from: &Path, to: &Path) -> io::Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "the destination appeared before the finished video could be saved",
        ));
    }
    fs::rename(from, to)
}

#[cfg(target_os = "linux")]
fn platform_exclusive_rename(from: &Path, to: &Path) -> io::Result<()> {
    let from = c_path(from)?;
    let to = c_path(to)?;
    // SAFETY: both pointers refer to NUL-terminated paths owned by the
    // `CString` values above and containing no interior NUL bytes.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn platform_exclusive_rename(from: &Path, to: &Path) -> io::Result<()> {
    let from = c_path(from)?;
    let to = c_path(to)?;
    // SAFETY: both pointers refer to NUL-terminated paths owned by the
    // `CString` values above and containing no interior NUL bytes.
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn c_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the output path contains a NUL byte",
        )
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaimLookup {
    ParentMissing,
    Unreadable,
    FileMissing {
        parent_device: Option<u64>,
    },
    Present {
        device: u64,
        inode: u64,
        partial_name: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaimDecision {
    Delete,
    Keep,
    Forget,
}

fn decide_claim(device: u64, inode: u64, lookup: ClaimLookup) -> ClaimDecision {
    match lookup {
        ClaimLookup::ParentMissing | ClaimLookup::Unreadable => ClaimDecision::Keep,
        ClaimLookup::FileMissing { parent_device } => match parent_device {
            Some(parent_device) if parent_device == device => ClaimDecision::Forget,
            _ => ClaimDecision::Keep,
        },
        ClaimLookup::Present {
            device: current_device,
            inode: current_inode,
            partial_name,
        } => {
            let same_file = current_device == device && current_inode == inode;
            if same_file || partial_name {
                ClaimDecision::Delete
            } else {
                ClaimDecision::Keep
            }
        }
    }
}

fn lookup_claim(path: &Path) -> ClaimLookup {
    let partial_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_partial_name);
    let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    else {
        return ClaimLookup::ParentMissing;
    };
    if parent.symlink_metadata().is_err() {
        return ClaimLookup::ParentMissing;
    }
    let parent_device = device_of(parent);
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            ClaimLookup::FileMissing { parent_device }
        }
        Err(_) => ClaimLookup::Unreadable,
        Ok(metadata) => match file_identity(&metadata) {
            Some(identity) => ClaimLookup::Present {
                device: identity.device,
                inode: identity.inode,
                partial_name,
            },
            None => ClaimLookup::Unreadable,
        },
    }
}

fn device_of(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        path.symlink_metadata().ok().map(|metadata| metadata.dev())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PartialClaim {
    path: String,
    device: u64,
    inode: u64,
}

impl PartialClaim {
    fn from_partial(partial: &PartialOutput) -> Option<Self> {
        Some(Self {
            path: partial.path.to_str()?.to_owned(),
            device: partial.device,
            inode: partial.inode,
        })
    }

    fn matches(&self, partial: &PartialOutput) -> bool {
        self.device == partial.device
            && self.inode == partial.inode
            && Path::new(&self.path) == partial.path
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialList {
    version: u32,
    partials: Vec<PartialClaim>,
}

/// Remembers partial files so a crash can remove them without scanning for,
/// or deleting, arbitrary user files.
pub(crate) struct PartialLedger {
    path: PathBuf,
    lock: Mutex<()>,
}

impl PartialLedger {
    pub(crate) fn open(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    pub(crate) fn record(&self, partial: &PartialOutput) -> ApiResult<()> {
        let claim = PartialClaim::from_partial(partial).ok_or_else(|| {
            ApiError::invalid_input("The output path must use a valid text encoding.")
        })?;
        let _guard = self.guard()?;
        let mut claims = load_claims(&self.path).map_err(ledger_error)?;
        if !claims.iter().any(|existing| existing.matches(partial)) {
            claims.push(claim);
        }
        persist_claims(&self.path, &claims).map_err(ledger_error)
    }

    pub(crate) fn forget(&self, partial: &PartialOutput) -> ApiResult<()> {
        let _guard = self.guard()?;
        let mut claims = load_claims(&self.path).map_err(ledger_error)?;
        claims.retain(|claim| !claim.matches(partial));
        persist_claims(&self.path, &claims).map_err(ledger_error)
    }

    pub(crate) fn recover_stale(&self) {
        let Ok(_guard) = self.lock.lock() else {
            eprintln!("Unable to clean up an unfinished video.");
            return;
        };
        let claims = match load_claims(&self.path) {
            Ok(claims) => claims,
            Err(error) => {
                eprintln!("Unable to read the unfinished video list: {error}");
                return;
            }
        };
        if claims.is_empty() {
            return;
        }
        let retry = claims
            .into_iter()
            .filter(|claim| recover_claim(claim) == PartialCleanup::Retry)
            .collect::<Vec<_>>();
        if let Err(error) = persist_claims(&self.path, &retry) {
            eprintln!("Unable to update the unfinished video list: {error}");
        }
    }

    fn guard(&self) -> ApiResult<MutexGuard<'_, ()>> {
        self.lock.lock().map_err(|_| {
            ApiError::new(
                "output_unavailable",
                "The conversion could not be started safely.",
            )
        })
    }
}

fn recover_claim(claim: &PartialClaim) -> PartialCleanup {
    if claim.path.is_empty() {
        return PartialCleanup::Resolved;
    }
    let path = PathBuf::from(&claim.path);
    match decide_claim(claim.device, claim.inode, lookup_claim(&path)) {
        ClaimDecision::Keep => PartialCleanup::Retry,
        ClaimDecision::Forget => PartialCleanup::Resolved,
        ClaimDecision::Delete => {
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_partial_name)
            {
                remove_owned(&path)
            } else {
                PartialCleanup::Retry
            }
        }
    }
}

fn load_claims(path: &Path) -> io::Result<Vec<PartialClaim>> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    if contents.is_empty() {
        return Ok(Vec::new());
    }
    let list: PartialList = serde_json::from_slice(&contents)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if list.version != PARTIAL_LIST_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unrecognized unfinished video list",
        ));
    }
    Ok(list.partials)
}

fn persist_claims(path: &Path, partials: &[PartialClaim]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_vec_pretty(&PartialList {
        version: PARTIAL_LIST_VERSION,
        partials: partials.to_vec(),
    })
    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let temporary = path.with_extension("json.tmp");
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temporary)?;
        file.write_all(&contents)?;
        file.sync_all()?;
    }
    if let Err(error) = replace_ledger_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn replace_ledger_file(source: &Path, destination: &Path) -> io::Result<()> {
    // App-data bookkeeping only. Windows cannot replace an existing file with
    // one rename, so this removes the previous ledger first. Media files are
    // never published through this helper.
    #[cfg(windows)]
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(source, destination)
}

fn ledger_error(error: io::Error) -> ApiError {
    eprintln!("Unable to update the unfinished video list: {error}");
    ApiError::new(
        "output_unavailable",
        "The conversion could not be started safely.",
    )
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::{
        create_error, create_owned, create_partial, decide_claim, destination_identity,
        discard_partial, ensure_partial_target, exclusive_or_absent, finalize_output,
        is_partial_name, numbered_names, publish_mode, rename_exclusive, rename_if_absent,
        retain_finished_partial, ClaimDecision, ClaimLookup, DestinationIdentity, ExistingOutput,
        FinalizeRequest, FinalizedOutput, OutputOutcome, PartialCleanup, PartialLedger,
        PartialOutput,
    };
    use std::{
        fs, io,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct Sample {
        _directory: TempDir,
        source: PathBuf,
        destination: PathBuf,
        partial: PartialOutput,
    }

    fn unique_dir(name: &str) -> TempDir {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "vidra-partial-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("the test directory should be created");
        TempDir(directory)
    }

    fn sample(name: &str, destination_contents: Option<&[u8]>) -> Sample {
        let directory = unique_dir(name);
        let source = directory.0.join("holiday.mov");
        fs::write(&source, b"source-bytes").expect("the source should be written");
        let destination = directory.0.join("holiday-vidra.mp4");
        if let Some(contents) = destination_contents {
            fs::write(&destination, contents).expect("the destination should be written");
        }
        let partial = create_partial(
            &destination,
            "job-7",
            "mp4",
            &[],
            std::slice::from_ref(&source),
        )
        .expect("the partial file should be created");
        fs::write(&partial.path, b"encoded-bytes").expect("the partial file should be writable");
        Sample {
            _directory: directory,
            source,
            destination,
            partial,
        }
    }

    fn finish(
        sample: &Sample,
        mode: ExistingOutput,
        outcome: OutputOutcome,
        replace_identity: Option<DestinationIdentity>,
    ) -> FinalizedOutput {
        let replace_identity = match replace_identity {
            Some(identity) => Some(identity),
            None if mode == ExistingOutput::Replace => destination_identity(&sample.destination),
            None => None,
        };
        finalize_output(FinalizeRequest {
            partial: &sample.partial,
            destination: &sample.destination,
            replace_identity,
            outcome,
            inputs: std::slice::from_ref(&sample.source),
            reserved: &[],
        })
    }

    fn assert_source_unchanged(sample: &Sample) {
        assert_eq!(fs::read(&sample.source).unwrap(), b"source-bytes");
    }

    fn assert_saved_elsewhere(sample: &Sample, finalized: &FinalizedOutput) {
        let saved = finalized.saved_path.as_ref().unwrap();
        assert_ne!(saved, &sample.destination);
        assert_eq!(fs::read(saved).unwrap(), b"encoded-bytes");
        assert!(!sample.partial.path.exists());
        assert!(finalized
            .error
            .as_ref()
            .unwrap()
            .message
            .contains("saved as"));
    }

    #[test]
    fn partial_names_are_hidden_siblings_and_are_not_finished_video_names() {
        let sample = sample("names", None);
        let name = sample
            .partial
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap();
        assert!(is_partial_name(name));
        assert!(name.starts_with(".vidra-partial-"));
        assert!(!is_partial_name("holiday-vidra.mp4"));
        assert!(!is_partial_name("holiday-vidra-2.mkv"));
        assert!(!is_partial_name(".vidra-partial-job-7-abc.mp4.tmp"));
        assert_eq!(
            numbered_names(&sample.destination)[0].file_name().unwrap(),
            "holiday-vidra-2.mp4"
        );
    }

    #[test]
    fn creating_a_partial_does_not_truncate_an_existing_file() {
        let directory = unique_dir("create-owned");
        let occupied = directory.0.join(".vidra-partial-job-1-abc.mp4");
        fs::write(&occupied, b"occupied-name").unwrap();
        let error = create_owned(&occupied).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&occupied).unwrap(), b"occupied-name");
    }

    #[test]
    fn a_read_only_folder_is_reported_clearly() {
        let error = create_error(&io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
        assert_eq!(error.code, "output_unavailable");
        assert!(error.message.contains("read-only"));
    }

    #[test]
    fn a_missing_destination_is_not_treated_as_replacement() {
        let directory = unique_dir("publish-mode");
        let destination = directory.0.join("holiday-vidra.mp4");
        assert_eq!(publish_mode(true, &destination), ExistingOutput::Reject);
        fs::write(&destination, b"original").unwrap();
        assert_eq!(publish_mode(true, &destination), ExistingOutput::Replace);
        assert_eq!(publish_mode(false, &destination), ExistingOutput::Reject);
    }

    #[test]
    fn failed_and_cancelled_jobs_keep_the_destination_source_and_remove_the_partial() {
        for mode in [ExistingOutput::Reject, ExistingOutput::Replace] {
            for outcome in [OutputOutcome::Failed, OutputOutcome::Cancelled] {
                for original in [None, Some(b"original".as_slice())] {
                    let sample = sample("survive", original);
                    let finalized = finish(&sample, mode, outcome, None);
                    assert_eq!(finalized.outcome, outcome);
                    assert!(finalized.saved_path.is_none());
                    assert!(!sample.partial.path.exists());
                    assert_source_unchanged(&sample);
                    match original {
                        Some(contents) => {
                            assert_eq!(fs::read(&sample.destination).unwrap(), contents)
                        }
                        None => assert!(!sample.destination.exists()),
                    }
                }
            }
        }
    }

    #[test]
    fn reject_mode_never_overwrites_and_keeps_the_finished_video() {
        let sample = sample("reject-existing", Some(b"original"));
        let sibling = sample.destination.with_file_name("notes.txt");
        fs::write(&sibling, b"notes").unwrap();
        let finalized = finish(
            &sample,
            ExistingOutput::Reject,
            OutputOutcome::Completed,
            None,
        );
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert_eq!(fs::read(&sample.destination).unwrap(), b"original");
        assert_eq!(fs::read(&sibling).unwrap(), b"notes");
        assert_saved_elsewhere(&sample, &finalized);
        assert_source_unchanged(&sample);
    }

    #[test]
    fn reject_mode_publishes_only_when_the_destination_is_absent() {
        let sample = sample("reject-publish", None);
        let finalized = finish(
            &sample,
            ExistingOutput::Reject,
            OutputOutcome::Completed,
            None,
        );
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert!(finalized.error.is_none());
        assert_eq!(fs::read(&sample.destination).unwrap(), b"encoded-bytes");
        assert!(!sample.partial.path.exists());
        assert_source_unchanged(&sample);
    }

    #[test]
    fn replace_mode_replaces_only_the_file_recorded_at_the_start() {
        let sample = sample("replace-success", Some(b"original"));
        let identity = destination_identity(&sample.destination).unwrap();
        let finalized = finish(
            &sample,
            ExistingOutput::Replace,
            OutputOutcome::Completed,
            Some(identity),
        );
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert!(finalized.error.is_none());
        assert_eq!(fs::read(&sample.destination).unwrap(), b"encoded-bytes");
        assert!(!sample.partial.path.exists());
        assert_source_unchanged(&sample);
    }

    #[test]
    fn replace_mode_does_not_replace_a_different_file_written_during_the_encode() {
        let sample = sample("replace-changed", Some(b"original"));
        let identity = destination_identity(&sample.destination).unwrap();
        let incoming = sample.destination.with_file_name("incoming.mp4");
        fs::write(&incoming, b"someone-else").unwrap();
        fs::rename(&incoming, &sample.destination).unwrap();
        assert_ne!(destination_identity(&sample.destination).unwrap(), identity);
        let finalized = finish(
            &sample,
            ExistingOutput::Replace,
            OutputOutcome::Completed,
            Some(identity),
        );
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert_eq!(fs::read(&sample.destination).unwrap(), b"someone-else");
        assert_saved_elsewhere(&sample, &finalized);
        assert_source_unchanged(&sample);
    }

    #[test]
    fn a_swapped_partial_is_not_published_or_deleted() {
        let sample = sample("swapped", Some(b"original"));
        let incoming = sample.partial.path.with_file_name("swapped-incoming.mp4");
        fs::write(&incoming, b"someone-else").unwrap();
        fs::rename(&incoming, &sample.partial.path).unwrap();
        let finalized = finish(
            &sample,
            ExistingOutput::Replace,
            OutputOutcome::Completed,
            None,
        );
        assert_eq!(finalized.outcome, OutputOutcome::Failed);
        assert_eq!(fs::read(&sample.destination).unwrap(), b"original");
        assert_eq!(fs::read(&sample.partial.path).unwrap(), b"someone-else");
        assert_source_unchanged(&sample);
    }

    #[test]
    fn a_different_file_at_the_partial_path_is_not_reported_as_the_video() {
        let sample = sample("retain-swapped", Some(b"original"));
        let incoming = sample.partial.path.with_file_name("retain-incoming.mp4");
        fs::write(&incoming, b"someone-else").unwrap();
        fs::rename(&incoming, &sample.partial.path).unwrap();
        let finalized = retain_finished_partial(&sample.partial);
        assert_eq!(finalized.outcome, OutputOutcome::Failed);
        assert!(finalized.saved_path.is_none());
        assert_eq!(fs::read(&sample.partial.path).unwrap(), b"someone-else");
        assert_eq!(fs::read(&sample.destination).unwrap(), b"original");
        assert_source_unchanged(&sample);
    }

    #[test]
    fn a_destination_in_another_directory_is_kept_with_the_finished_video() {
        let directory = unique_dir("other-dir");
        let source = directory.0.join("holiday.mov");
        fs::write(&source, b"source-bytes").unwrap();
        let destination = directory.0.join("holiday-vidra.mp4");
        fs::write(&destination, b"original").unwrap();
        let elsewhere = directory.0.join("elsewhere");
        fs::create_dir(&elsewhere).unwrap();
        let partial = create_partial(
            &elsewhere.join("holiday-vidra.mp4"),
            "job-5",
            "mp4",
            &[],
            std::slice::from_ref(&source),
        )
        .unwrap();
        fs::write(&partial.path, b"encoded-bytes").unwrap();
        let finalized = finalize_output(FinalizeRequest {
            partial: &partial,
            destination: &destination,
            replace_identity: destination_identity(&destination),
            outcome: OutputOutcome::Completed,
            inputs: std::slice::from_ref(&source),
            reserved: &[],
        });
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert_eq!(fs::read(&source).unwrap(), b"source-bytes");
        let saved = finalized.saved_path.unwrap();
        assert_eq!(fs::read(&saved).unwrap(), b"encoded-bytes");
        assert_ne!(saved.parent(), destination.parent());
        assert!(!is_partial_name(
            saved.file_name().unwrap().to_str().unwrap()
        ));
    }

    #[test]
    fn publish_does_not_replace_a_directory_at_the_destination() {
        let sample = sample("directory", None);
        fs::create_dir(&sample.destination).unwrap();
        fs::write(sample.destination.join("inside.txt"), b"keep").unwrap();
        let finalized = finish(
            &sample,
            ExistingOutput::Replace,
            OutputOutcome::Completed,
            None,
        );
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert_eq!(
            fs::read(sample.destination.join("inside.txt")).unwrap(),
            b"keep"
        );
        assert_saved_elsewhere(&sample, &finalized);
        assert_source_unchanged(&sample);
    }

    #[test]
    fn exclusive_rename_leaves_an_existing_file() {
        let directory = unique_dir("exclusive-rename");
        let partial = directory.0.join("partial.mp4");
        let destination = directory.0.join("holiday-vidra.mp4");
        fs::write(&partial, b"encoded-bytes").unwrap();
        fs::write(&destination, b"original").unwrap();
        let error = rename_exclusive(&partial, &destination).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert_eq!(fs::read(&partial).unwrap(), b"encoded-bytes");
        fs::remove_file(&destination).unwrap();
        rename_exclusive(&partial, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"encoded-bytes");
        assert!(!partial.exists());
    }

    #[test]
    fn rename_if_absent_keeps_an_existing_file_and_moves_a_free_name() {
        let directory = unique_dir("rename-if-absent");
        let partial = directory.0.join("partial.mp4");
        let destination = directory.0.join("holiday-vidra.mp4");
        fs::write(&partial, b"encoded-bytes").unwrap();
        fs::write(&destination, b"original").unwrap();
        let error = rename_if_absent(&partial, &destination).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert_eq!(fs::read(&partial).unwrap(), b"encoded-bytes");
        fs::remove_file(&destination).unwrap();
        rename_if_absent(&partial, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"encoded-bytes");
        assert!(!partial.exists());
    }

    #[test]
    fn unsupported_exclusive_renames_fall_back_only_when_the_name_is_free() {
        for code in [libc::ENOTSUP, libc::ENOSYS, libc::EINVAL, libc::EOPNOTSUPP] {
            let mut renamed = false;
            let result =
                exclusive_or_absent(Err(io::Error::from_raw_os_error(code)), false, || {
                    renamed = true;
                    Ok(())
                });
            assert!(result.is_ok(), "{code}");
            assert!(renamed, "{code}");
        }

        let mut renamed = false;
        let blocked = exclusive_or_absent(
            Err(io::Error::from_raw_os_error(libc::ENOTSUP)),
            true,
            || {
                renamed = true;
                Ok(())
            },
        );
        assert_eq!(blocked.unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert!(!renamed);

        let mut renamed = false;
        let exists = exclusive_or_absent(
            Err(io::Error::new(io::ErrorKind::AlreadyExists, "exists")),
            false,
            || {
                renamed = true;
                Ok(())
            },
        );
        assert_eq!(exists.unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert!(!renamed);

        let other = exclusive_or_absent(
            Err(io::Error::from_raw_os_error(libc::EACCES)),
            false,
            || Ok(()),
        );
        assert_eq!(other.unwrap_err().raw_os_error(), Some(libc::EACCES));
    }

    #[test]
    fn ffmpeg_output_must_be_the_partial_sibling() {
        let destination = Path::new("/videos/holiday-vidra.mkv");
        let partial = Path::new("/videos/.vidra-partial-job-1-abc123.mkv");
        assert!(ensure_partial_target(destination, partial).is_ok());
        assert!(ensure_partial_target(destination, destination).is_err());
        assert!(ensure_partial_target(
            destination,
            Path::new("/elsewhere/.vidra-partial-job-1-abc123.mkv"),
        )
        .is_err());
    }

    #[test]
    fn startup_removes_only_claimed_partials() {
        let directory = unique_dir("recover");
        let destination = directory.0.join("holiday-vidra.mp4");
        fs::write(&destination, b"original").unwrap();
        let partial = create_partial(&destination, "job-4", "mp4", &[], &[]).unwrap();
        fs::write(&partial.path, b"unfinished").unwrap();
        let decoy = directory.0.join(".vidra-partial-job-9-abc.mp4");
        fs::write(&decoy, b"user-owned").unwrap();
        let ledger = PartialLedger::open(directory.0.join("partial-outputs.json"));
        ledger.record(&partial).unwrap();
        ledger.recover_stale();
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert!(!partial.path.exists());
        assert_eq!(fs::read(&decoy).unwrap(), b"user-owned");
    }

    #[test]
    fn startup_removes_a_partial_whose_inode_changed() {
        let directory = unique_dir("recover-mismatch");
        let destination = directory.0.join("holiday-vidra.mp4");
        fs::write(&destination, b"original").unwrap();
        let partial = create_partial(&destination, "job-4", "mp4", &[], &[]).unwrap();
        let ledger_path = directory.0.join("partial-outputs.json");
        let ledger = PartialLedger::open(ledger_path.clone());
        ledger.record(&partial).unwrap();
        fs::remove_file(&partial.path).unwrap();
        fs::write(&partial.path, b"replaced-after-crash").unwrap();
        ledger.recover_stale();
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert!(!partial.path.exists());
        let text = fs::read_to_string(&ledger_path).unwrap();
        assert!(!text.contains(&partial.path.display().to_string()));
    }

    #[test]
    fn startup_keeps_a_claim_when_the_volume_is_not_mounted() {
        let directory = unique_dir("unmounted");
        let missing = directory
            .0
            .join("missing-volume")
            .join(".vidra-partial-job-1-abc123.mp4");
        let partial = PartialOutput {
            path: missing.clone(),
            device: 9,
            inode: 9,
        };
        let ledger_path = directory.0.join("partial-outputs.json");
        PartialLedger::open(ledger_path.clone())
            .record(&partial)
            .unwrap();
        PartialLedger::open(ledger_path.clone()).recover_stale();
        let text = fs::read_to_string(&ledger_path).unwrap();
        assert!(text.contains(missing.to_str().unwrap()));
        assert!(!missing.exists());
    }

    #[test]
    fn startup_forgets_a_claim_when_the_partial_file_is_gone() {
        let directory = unique_dir("gone");
        let destination = directory.0.join("holiday-vidra.mp4");
        let partial = create_partial(&destination, "job-4", "mp4", &[], &[]).unwrap();
        let ledger_path = directory.0.join("partial-outputs.json");
        let ledger = PartialLedger::open(ledger_path.clone());
        ledger.record(&partial).unwrap();
        fs::remove_file(&partial.path).unwrap();
        ledger.recover_stale();
        let text = fs::read_to_string(&ledger_path).unwrap();
        assert!(!text.contains(partial.path.file_name().unwrap().to_str().unwrap()));
    }

    #[test]
    fn a_claim_on_another_device_is_kept_when_the_file_is_absent() {
        assert_eq!(
            decide_claim(
                7,
                11,
                ClaimLookup::FileMissing {
                    parent_device: Some(99),
                }
            ),
            ClaimDecision::Keep
        );
        assert_eq!(
            decide_claim(7, 11, ClaimLookup::ParentMissing),
            ClaimDecision::Keep
        );
        assert_eq!(
            decide_claim(
                7,
                11,
                ClaimLookup::FileMissing {
                    parent_device: Some(7),
                }
            ),
            ClaimDecision::Forget
        );
        assert_eq!(
            decide_claim(
                7,
                11,
                ClaimLookup::Present {
                    device: 99,
                    inode: 11,
                    partial_name: true,
                }
            ),
            ClaimDecision::Delete
        );
    }

    #[test]
    fn a_corrupt_claim_list_does_not_delete_media() {
        let directory = unique_dir("corrupt-ledger");
        let destination = directory.0.join("holiday-vidra.mp4");
        let partial = directory.0.join(".vidra-partial-job-1-abc.mp4");
        fs::write(&destination, b"original").unwrap();
        fs::write(&partial, b"keep").unwrap();
        let ledger_path = directory.0.join("partial-outputs.json");
        fs::write(&ledger_path, b"not json").unwrap();
        PartialLedger::open(ledger_path.clone()).recover_stale();
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert_eq!(fs::read(&partial).unwrap(), b"keep");
        assert_eq!(fs::read(&ledger_path).unwrap(), b"not json");
    }

    #[test]
    fn discard_removes_the_owned_partial_only() {
        let sample = sample("discard", Some(b"original"));
        assert_eq!(discard_partial(&sample.partial), PartialCleanup::Resolved);
        assert!(!sample.partial.path.exists());
        assert_eq!(fs::read(&sample.destination).unwrap(), b"original");
        assert_source_unchanged(&sample);
    }

    #[cfg(unix)]
    #[test]
    fn publish_does_not_replace_a_symlink_or_follow_it() {
        use std::os::unix::fs::symlink;
        let sample = sample("symlink", None);
        let target = sample._directory.0.join("target.mp4");
        fs::write(&target, b"target-bytes").unwrap();
        symlink(&target, &sample.destination).unwrap();
        let finalized = finish(
            &sample,
            ExistingOutput::Replace,
            OutputOutcome::Completed,
            None,
        );
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert_eq!(fs::read(&target).unwrap(), b"target-bytes");
        assert!(sample
            .destination
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
        assert_saved_elsewhere(&sample, &finalized);
        assert_source_unchanged(&sample);
    }

    #[cfg(unix)]
    #[test]
    fn publish_does_not_replace_a_hard_link_to_the_source() {
        let sample = sample("hard-link", None);
        fs::hard_link(&sample.source, &sample.destination).unwrap();
        let finalized = finish(
            &sample,
            ExistingOutput::Replace,
            OutputOutcome::Completed,
            destination_identity(&sample.destination),
        );
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert_eq!(fs::read(&sample.destination).unwrap(), b"source-bytes");
        assert_eq!(fs::read(&sample.source).unwrap(), b"source-bytes");
        assert_saved_elsewhere(&sample, &finalized);
    }

    #[test]
    fn a_non_canonical_destination_publishes_beside_the_partial() {
        let directory = unique_dir("non-canonical");
        let videos = directory.0.join("videos");
        fs::create_dir(&videos).unwrap();
        let source = videos.join("holiday.mov");
        fs::write(&source, b"source-bytes").unwrap();
        let canonical = videos.join("holiday-vidra.mp4");
        let partial = create_partial(
            &canonical,
            "job-3",
            "mp4",
            &[],
            std::slice::from_ref(&source),
        )
        .unwrap();
        fs::write(&partial.path, b"encoded-bytes").unwrap();
        let requested = videos.join("..").join("videos").join("holiday-vidra.mp4");
        let finalized = finalize_output(FinalizeRequest {
            partial: &partial,
            destination: &requested,
            replace_identity: None,
            outcome: OutputOutcome::Completed,
            inputs: std::slice::from_ref(&source),
            reserved: &[],
        });
        assert_eq!(finalized.outcome, OutputOutcome::Completed);
        assert_eq!(fs::read(&canonical).unwrap(), b"encoded-bytes");
        assert!(!partial.path.exists());
    }
}
