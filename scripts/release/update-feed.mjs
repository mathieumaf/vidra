import { assertSignedVersionsMatch } from "./updater-signature.mjs";
import { compareVersions, isOfficialVersion, versionFromReleaseTag } from "./version.mjs";

// Installed copies of Vidra read one update feed: the `latest.json` asset of
// the rolling `updater-manifest` release. Copies installed from a 0.2.0 beta
// or release candidate read `beta.json` there first. Both assets receive every
// official release, so each installed copy moves to it.

export const FEED_RELEASE_TAG = "updater-manifest";
export const FEED_ASSETS = ["latest.json", "beta.json"];

/** A manifest the updater can use: a version and, per platform, an HTTPS URL and a signature. */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The update manifest must be a JSON object.");
  }
  if (typeof manifest.version !== "string") {
    throw new Error("The update manifest must contain a version.");
  }
  isOfficialVersion(manifest.version);
  const platforms = Object.values(manifest.platforms ?? {});
  if (platforms.length === 0 || platforms.some((platform) => (
    !platform || typeof platform.url !== "string" || typeof platform.signature !== "string"
  ))) {
    throw new Error("Every update platform must contain a download URL and a signature.");
  }
  if (platforms.some((platform) => !platform.url.startsWith("https://"))) {
    throw new Error("Every update download URL must use HTTPS.");
  }
  return manifest;
}

/** Every address under which GitHub serves the updater archives attached to a release. */
export function updaterArchiveUrls(assets) {
  return (assets ?? [])
    .filter((asset) => typeof asset?.name === "string" && asset.name.endsWith(".app.tar.gz"))
    .flatMap((asset) => [asset.url, asset.apiUrl, asset.browser_download_url])
    .filter((url) => typeof url === "string");
}

/**
 * Check the manifest attached to a release before it is offered to installed
 * copies: it announces exactly the release's version, its signatures were made
 * for that version, and it downloads an archive attached to that release.
 */
export function validateReleaseManifest({ manifest, tag, assets }) {
  validateManifest(manifest);
  const version = versionFromReleaseTag(tag);
  if (manifest.version !== version) {
    throw new Error(`The update manifest announces ${manifest.version}, but the release tag is ${tag}.`);
  }
  assertSignedVersionsMatch(manifest);
  const allowed = new Set(updaterArchiveUrls(assets));
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (!allowed.has(entry.url)) {
      throw new Error(`The ${platform} update does not download an updater archive attached to release ${tag}: ${entry.url}`);
    }
  }
  return manifest;
}

/**
 * Whether a feed asset moves to the incoming release. The feed only moves
 * forward: an equal or older release never replaces what is published.
 */
export function feedMovesTo(incoming, current) {
  if (current === null || current === undefined) return true;
  if (!current || typeof current.version !== "string") {
    throw new Error("The published update feed is not a manifest with a version. Repair it by hand before publishing.");
  }
  return compareVersions(incoming.version, current.version) > 0;
}

/** Refuse to offer a release that GitHub does not show as a published, official one. */
export function assertPublishedOfficialRelease(release, tag) {
  if (!release || release.draft) {
    throw new Error(`Release ${tag} is a draft. A draft is never offered as an update.`);
  }
  if (release.prerelease) {
    throw new Error(`Release ${tag} is marked as a prerelease. Vidra offers official releases only.`);
  }
}
