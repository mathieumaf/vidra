import { assertSignedVersionsMatch } from "./updater-signature.mjs";
import { compareVersions, versionFromReleaseTag } from "./version.mjs";

// Installed copies of Vidra read one update feed: the `latest.json` asset of
// the rolling `updater-manifest` release. Copies installed from a 0.2.0 beta
// or release candidate read `beta.json` there first. Both assets receive every
// official release, so each installed copy moves to it.

export const FEED_RELEASE_TAG = "updater-manifest";
export const FEED_ASSETS = ["latest.json", "beta.json"];

/** The entry of the update manifest that a copy of Vidra on Apple Silicon selects. */
export const REQUIRED_PLATFORM = "darwin-aarch64";

/** A manifest the updater can read: a semantic version and, per platform, an HTTPS URL and a signature. */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The update manifest must be a JSON object.");
  }
  if (typeof manifest.version !== "string") {
    throw new Error("The update manifest must contain a version.");
  }
  // Throws when the version is not a semantic version. A feed asset left by
  // the last release candidate holds a prerelease version, which is valid here.
  compareVersions(manifest.version, manifest.version);
  if (!manifest.platforms || typeof manifest.platforms !== "object" || Array.isArray(manifest.platforms)) {
    throw new Error("The update manifest must contain a platforms object.");
  }
  const platforms = Object.values(manifest.platforms);
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
  if (!Object.hasOwn(manifest.platforms, REQUIRED_PLATFORM)) {
    throw new Error(`The update manifest has no ${REQUIRED_PLATFORM} entry, so no copy of Vidra could select this update.`);
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
 * What each feed asset must hold after a release is published: the newest of
 * that release and everything the feed already offers. The feed only moves
 * forward, and a feed asset that went missing is restored from the other one,
 * so an older release can never fill the gap.
 *
 * `current` maps each feed asset name to its manifest, or to null when the
 * asset is missing. Returns the manifest to offer and the assets to write.
 */
export function feedUpdate(incoming, current) {
  let target = incoming;
  for (const [asset, manifest] of Object.entries(current)) {
    if (manifest === null) continue;
    if (!manifest || typeof manifest.version !== "string") {
      throw new Error(`The published ${asset} is not a manifest with a version. Repair the update feed by hand before publishing.`);
    }
    if (compareVersions(manifest.version, target.version) > 0) target = manifest;
  }
  const assets = Object.entries(current)
    .filter(([, manifest]) => manifest === null || compareVersions(target.version, manifest.version) > 0)
    .map(([asset]) => asset);
  return { target, assets };
}

/**
 * The release workflow attaches the disk image's checksum and the FFmpeg
 * corresponding sources in its last step, after every check has passed. A
 * release without them comes from a run that did not finish.
 */
export function assertReleaseComplete(assets, tag) {
  const names = (assets ?? []).map((asset) => asset?.name).filter((name) => typeof name === "string");
  const required = [
    ["an updater archive", (name) => name.endsWith(".app.tar.gz")],
    ["the updater archive's signature", (name) => name.endsWith(".app.tar.gz.sig")],
    ["a disk image", (name) => name.endsWith(".dmg")],
    ["the disk image's checksum", (name) => name.endsWith(".dmg.sha256")],
    ["the FFmpeg corresponding sources (SHA256SUMS)", (name) => name === "SHA256SUMS"],
  ];
  const missing = required.filter(([, matches]) => !names.some(matches)).map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(`Release ${tag} is incomplete, so its release workflow did not finish. Missing: ${missing.join(", ")}.`);
  }
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
