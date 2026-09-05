use crate::{
    error::{ApiError, ApiResult},
    jobs::JobManager,
};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::{Updater, UpdaterExt};

const STABLE_ENDPOINT: &str =
    "https://github.com/mathieumaf/vidra/releases/download/updater-manifest/latest.json";
const BETA_ENDPOINT: &str =
    "https://github.com/mathieumaf/vidra/releases/download/updater-manifest/beta.json";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    fn endpoints(self) -> &'static [&'static str] {
        match self {
            Self::Stable => &[STABLE_ENDPOINT],
            // Until the first beta manifest is published, use the existing feed.
            Self::Beta => &[BETA_ENDPOINT, STABLE_ENDPOINT],
        }
    }

    fn offers(self, installed_version: &Version, remote_version: &Version) -> bool {
        (self == Self::Beta || remote_version.pre.is_empty())
            && remote_version.cmp_precedence(installed_version).is_gt()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableApplicationUpdate {
    current_version: String,
    version: String,
    date: Option<String>,
    notes: Option<String>,
}

fn channel_updater(app: &AppHandle, channel: UpdateChannel) -> ApiResult<Updater> {
    let endpoints = channel
        .endpoints()
        .iter()
        .map(|endpoint| endpoint.parse().map_err(update_error))
        .collect::<ApiResult<Vec<_>>>()?;
    app.updater_builder()
        .endpoints(endpoints)
        .map_err(update_error)?
        .timeout(Duration::from_secs(30))
        .version_comparator(move |bundle_version, release| {
            let installed =
                installed_release_version(bundle_version, option_env!("VIDRA_RELEASE_TAG"));
            channel.offers(&installed, &release.version)
        })
        .build()
        .map_err(update_error)
}

fn installed_release_version(current_version: Version, release_tag: Option<&str>) -> Version {
    release_tag
        .and_then(|tag| Version::parse(tag.trim_start_matches('v')).ok())
        .unwrap_or(current_version)
}

#[tauri::command]
pub async fn check_application_update(
    app: AppHandle,
    channel: UpdateChannel,
) -> ApiResult<Option<AvailableApplicationUpdate>> {
    let update = channel_updater(&app, channel)?
        .check()
        .await
        .map_err(update_error)?;
    Ok(update.map(|update| AvailableApplicationUpdate {
        current_version: installed_release_version(
            app.package_info().version.clone(),
            option_env!("VIDRA_RELEASE_TAG"),
        )
        .to_string(),
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
    channel: UpdateChannel,
) -> ApiResult<()> {
    let _update_guard = jobs.begin_update()?;
    let updater = channel_updater(&app, channel)?;
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
    use super::{installed_release_version, UpdateChannel, BETA_ENDPOINT, STABLE_ENDPOINT};
    use semver::Version;

    #[test]
    fn stable_never_offers_prereleases_even_from_a_misconfigured_feed() {
        let installed = Version::parse("0.1.0").unwrap();
        for remote in ["0.2.0-beta.1", "1.0.0-rc.1", "2.0.0-alpha.1"] {
            assert!(!UpdateChannel::Stable.offers(&installed, &Version::parse(remote).unwrap()));
        }
        assert!(UpdateChannel::Stable.offers(&installed, &Version::parse("0.1.1").unwrap()));
    }

    #[test]
    fn beta_accepts_newer_test_and_official_releases() {
        for (current, remote) in [
            ("0.1.0", "0.2.0-beta.1"),
            ("0.2.0-beta.2", "0.2.0-beta.10"),
            ("0.2.0-beta.10", "0.2.0-rc.1"),
            ("0.2.0-rc.1", "0.2.0"),
        ] {
            assert!(UpdateChannel::Beta.offers(
                &Version::parse(current).unwrap(),
                &Version::parse(remote).unwrap(),
            ));
        }
    }

    #[test]
    fn switching_channels_never_downgrades_or_reinstalls() {
        for channel in [UpdateChannel::Stable, UpdateChannel::Beta] {
            for (current, remote) in [
                ("0.2.0-beta.1", "0.1.0"),
                ("0.2.0", "0.2.0-rc.1"),
                ("0.1.0", "0.1.0"),
                ("0.1.0+build.1", "0.1.0+build.2"),
            ] {
                assert!(!channel.offers(
                    &Version::parse(current).unwrap(),
                    &Version::parse(remote).unwrap(),
                ));
            }
        }
    }

    #[test]
    fn beta_five_can_upgrade_to_official_despite_the_shared_bundle_version() {
        let installed =
            installed_release_version(Version::parse("0.1.0").unwrap(), Some("v0.1.0-beta.5"));
        let official = Version::parse("0.1.0").unwrap();
        assert!(UpdateChannel::Stable.offers(&installed, &official));
        assert!(UpdateChannel::Beta.offers(&installed, &official));
    }

    #[test]
    fn channels_only_use_the_fixed_github_endpoints() {
        assert_eq!(UpdateChannel::Stable.endpoints(), &[STABLE_ENDPOINT]);
        assert_eq!(
            UpdateChannel::Beta.endpoints(),
            &[BETA_ENDPOINT, STABLE_ENDPOINT]
        );
        assert_eq!(
            serde_json::from_str::<UpdateChannel>("\"stable\"").unwrap(),
            UpdateChannel::Stable
        );
        assert_eq!(
            serde_json::from_str::<UpdateChannel>("\"beta\"").unwrap(),
            UpdateChannel::Beta
        );
        assert!(serde_json::from_str::<UpdateChannel>("\"nightly\"").is_err());
        assert!(serde_json::from_str::<UpdateChannel>("\"https://example.com\"").is_err());
    }

    #[test]
    fn exact_build_tag_overrides_the_bundle_version() {
        let installed =
            installed_release_version(Version::parse("1.0.0").unwrap(), Some("v1.0.0-beta.2"));

        assert_eq!(installed, Version::parse("1.0.0-beta.2").unwrap());
    }
}
