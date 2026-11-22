import { assertSignedVersionsMatch } from "./updater-signature.mjs";
import { compareVersions, isOfficialVersion, versionFromReleaseTag } from "./version.mjs";

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
 * Which feed assets move to the incoming release. The feed only moves forward:
 * an asset that already offers an equal or newer version stays.
 *
 * `current` maps each feed asset name to its manifest, or to null when the
 * asset is missing. A missing asset is filled with the incoming manifest,
 * unless another feed asset already offers a newer official release: the gap
 * would then be filled with an older release than the feed offers, and the
 * surviving manifest was not verified by this run, so the publication stops
 * instead. A prerelease left in the legacy beta asset does not count: no
 * installed copy that reads the missing asset is offered a prerelease.
 */
export function feedUpdate(incoming, current) {
  let newest = null;
  for (const [asset, manifest] of Object.entries(current)) {
    if (manifest === null) continue;
    if (!manifest || typeof manifest.version !== "string") {
      throw new Error(`The published ${asset} is not a manifest with a version. Repair the update feed by hand before publishing.`);
    }
    if (!isOfficialVersion(manifest.version)) continue;
    if (newest === null || compareVersions(manifest.version, newest.version) > 0) {
      newest = { asset, version: manifest.version };
    }
  }
  const assets = [];
  for (const [asset, manifest] of Object.entries(current)) {
    if (manifest === null) {
      if (newest !== null && compareVersions(newest.version, incoming.version) > 0) {
        throw new Error(
          `${asset} is missing from the update feed, and ${newest.asset} already offers ${newest.version}, which is newer than ${incoming.version}. `
          + `Restore ${asset} by publishing the feed for ${newest.version} again, or by hand.`,
        );
      }
      assets.push(asset);
    } else if (compareVersions(incoming.version, manifest.version) > 0) {
      assets.push(asset);
    }
  }
  return assets;
}

/** The asset the release workflow uploads last, after every other step succeeded. */
export const COMPLETION_MARKER = "release-complete.json";

const REQUIRED_ASSETS = [
  ["an updater archive", (name) => name.endsWith(".app.tar.gz")],
  ["the updater archive's signature", (name) => name.endsWith(".app.tar.gz.sig")],
  ["the update manifest (latest.json)", (name) => name === "latest.json"],
  ["a disk image", (name) => name.endsWith(".dmg")],
  ["the disk image's checksum", (name) => name.endsWith(".dmg.sha256")],
  ["the FFmpeg source checksums (SHA256SUMS)", (name) => name === "SHA256SUMS"],
  ["the FFmpeg build configuration (BUILD_CONFIGURATION.txt)", (name) => name === "BUILD_CONFIGURATION.txt"],
];

function assetNames(assets) {
  return (assets ?? []).map((asset) => (typeof asset === "string" ? asset : asset?.name)).filter((name) => typeof name === "string");
}

/**
 * The marker of a finished release: its tag, its commit, and the names of
 * everything attached to it. It can only be made when every kind of asset and
 * every FFmpeg source archive the recipe pins is attached.
 */
export function completionMarker({ tag, commit, assets, sourceArchives }) {
  versionFromReleaseTag(tag);
  const names = assetNames(assets);
  const missing = [
    ...REQUIRED_ASSETS.filter(([, matches]) => !names.some(matches)).map(([label]) => label),
    ...sourceArchives.filter((name) => !names.includes(name)),
  ];
  if (missing.length > 0) {
    throw new Error(`Release ${tag} is incomplete. Missing: ${missing.join(", ")}.`);
  }
  return { tag, commit, assets: [...names].sort() };
}

/**
 * A published release is complete when it carries the marker of its own tag,
 * made at the commit the tag names today, and still has everything that
 * marker lists. A release without the marker comes from a run that did not
 * finish. A marker for another commit comes from a tag that was moved since.
 */
export function assertReleaseComplete(assets, tag, marker, commit) {
  const names = assetNames(assets);
  if (!marker || marker.tag !== tag || !Array.isArray(marker.assets)) {
    throw new Error(`Release ${tag} has no ${COMPLETION_MARKER} for this tag, so its release workflow did not finish.`);
  }
  if (!commit || marker.commit !== commit) {
    throw new Error(`Release ${tag} was built from commit ${marker.commit}, and the tag names ${commit || "no commit"}.`);
  }
  const missing = [
    ...REQUIRED_ASSETS.filter(([, matches]) => !names.some(matches)).map(([label]) => label),
    ...marker.assets.filter((name) => !names.includes(name)),
  ];
  if (missing.length > 0) {
    throw new Error(`Release ${tag} is incomplete. Missing: ${missing.join(", ")}.`);
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
