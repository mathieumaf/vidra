use crate::{
    error::{ApiError, ApiResult},
    jobs::JobManager,
};
use semver::Version;
use serde::Serialize;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::{Updater, UpdaterExt};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableApplicationUpdate {
    current_version: String,
    version: String,
    date: Option<String>,
    notes: Option<String>,
}

/// Vidra publishes official releases only. A newer official version is
/// offered; a prerelease, an equal version, or an older one never is, whatever
/// the update feed contains.
fn offers(installed_version: &Version, remote_version: &Version) -> bool {
    remote_version.pre.is_empty() && remote_version.cmp_precedence(installed_version).is_gt()
}

/// The update feed and its public key come from `tauri.conf.json`.
fn updater(app: &AppHandle) -> ApiResult<Updater> {
    app.updater_builder()
        .timeout(Duration::from_secs(30))
        .version_comparator(|installed_version, release| {
            offers(&installed_version, &release.version)
        })
        .build()
        .map_err(update_error)
}

#[tauri::command]
pub async fn check_application_update(
    app: AppHandle,
) -> ApiResult<Option<AvailableApplicationUpdate>> {
    let update = updater(&app)?.check().await.map_err(update_error)?;
    Ok(update.map(|update| AvailableApplicationUpdate {
        current_version: app.package_info().version.to_string(),
        version: update.version,
        date: update.raw_json["pub_date"].as_str().map(str::to_owned),
        notes: update.body,
    }))
}

#[tauri::command]
pub async fn install_application_update(
    app: AppHandle,
    jobs: tauri::State<'_, JobManager>,
    expected_version: String,
) -> ApiResult<()> {
    let _update_guard = jobs.begin_update()?;
    let update = updater(&app)?
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
    use super::offers;
    use semver::Version;

    fn version(value: &str) -> Version {
        Version::parse(value).unwrap()
    }

    #[test]
    fn offers_a_newer_official_release() {
        for (installed, remote) in [
            ("0.1.0", "0.1.1"),
            ("0.1.0", "0.2.0"),
            ("0.9.0", "0.10.0"),
            ("0.2.0", "1.0.0"),
        ] {
            assert!(offers(&version(installed), &version(remote)));
        }
    }

    #[test]
    fn never_offers_a_prerelease_even_from_a_misconfigured_feed() {
        let installed = version("0.1.0");
        for remote in ["0.2.0-beta.1", "1.0.0-rc.1", "2.0.0-alpha.1"] {
            assert!(!offers(&installed, &version(remote)));
        }
    }

    #[test]
    fn never_downgrades_or_reinstalls() {
        for (installed, remote) in [
            ("0.2.0", "0.1.0"),
            ("0.1.0", "0.1.0"),
            ("0.1.0+build.1", "0.1.0+build.2"),
        ] {
            assert!(!offers(&version(installed), &version(remote)));
        }
    }

    #[test]
    fn the_update_feed_is_the_fixed_github_endpoint() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["plugins"]["updater"]["endpoints"],
            serde_json::json!([
                "https://github.com/mathieumaf/vidra/releases/download/updater-manifest/latest.json"
            ])
        );
    }
}
