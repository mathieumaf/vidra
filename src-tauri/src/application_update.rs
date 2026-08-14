use crate::{
    error::{ApiError, ApiResult},
    jobs::JobManager,
};
use semver::Version;
use tauri::AppHandle;
use tauri_plugin_updater::{RemoteRelease, UpdaterExt};

pub fn is_newer_release(current_version: Version, remote_release: RemoteRelease) -> bool {
    compare_release_versions(current_version, remote_release.version)
}

fn compare_release_versions(current_version: Version, remote_version: Version) -> bool {
    let installed_version =
        installed_release_version(current_version, option_env!("VIDRA_RELEASE_TAG"));
    remote_version > installed_version
}

fn installed_release_version(current_version: Version, release_tag: Option<&str>) -> Version {
    release_tag
        .and_then(|tag| Version::parse(tag.trim_start_matches('v')).ok())
        .unwrap_or(current_version)
}

#[tauri::command]
pub async fn install_application_update(
    app: AppHandle,
    jobs: tauri::State<'_, JobManager>,
    expected_version: String,
) -> ApiResult<()> {
    let _update_guard = jobs.begin_update()?;
    let updater = app.updater().map_err(update_error)?;
    let update = updater
        .check()
        .await
        .map_err(update_error)?
        .ok_or_else(|| {
            ApiError::new("update_unavailable", "No application update is available.")
        })?;

    if update.version != expected_version {
        return Err(ApiError::new(
            "update_changed",
            "The available update changed. Check for updates again before installing it.",
        ));
    }

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(update_error)?;
    app.restart();
}

fn update_error(error: impl std::fmt::Display) -> ApiError {
    ApiError::new(
        "update_error",
        format!("The application update failed: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::{compare_release_versions, installed_release_version};
    use semver::Version;

    #[test]
    fn compares_semantic_release_versions() {
        assert!(compare_release_versions(
            Version::parse("1.0.0-beta.2").unwrap(),
            Version::parse("1.0.0-beta.3").unwrap(),
        ));
        assert!(!compare_release_versions(
            Version::parse("1.0.0").unwrap(),
            Version::parse("1.0.0-beta.3").unwrap(),
        ));
    }

    #[test]
    fn exact_build_tag_overrides_the_bundle_version() {
        let installed =
            installed_release_version(Version::parse("1.0.0").unwrap(), Some("v1.0.0-beta.2"));

        assert_eq!(installed, Version::parse("1.0.0-beta.2").unwrap());
    }
}
