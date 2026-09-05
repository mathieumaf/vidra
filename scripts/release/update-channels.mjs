import { prepareUpdaterManifest, versionFromReleaseTag } from "./prepare-updater-manifest.mjs";

function versionParts(value) {
  const version = versionFromReleaseTag(value).split("+")[0];
  const [, core, prerelease] = version.match(/^([\d.]+)(?:-(.+))?$/);
  return { core: core.split(".").map(BigInt), prerelease: prerelease?.split(".") ?? [] };
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest.version !== "string") {
    throw new Error("An updater manifest must contain a version.");
  }
  prepareUpdaterManifest(manifest, manifest.version);
  return manifest;
}

function newest(...manifests) {
  return manifests.filter(Boolean).reduce((selected, manifest) => (
    !selected || compareVersions(manifest.version, selected.version) > 0 ? manifest : selected
  ), null);
}

export function channelPromotions({ incoming, tag, prerelease, stable = null, beta = null }) {
  validateManifest(incoming);
  if (stable) validateManifest(stable);
  if (beta) validateManifest(beta);
  const version = versionFromReleaseTag(tag);
  if (incoming.version !== version) throw new Error("The manifest version must match the published release tag.");
  const isPrerelease = versionParts(version).prerelease.length > 0;
  if (typeof prerelease !== "boolean" || prerelease !== isPrerelease) {
    throw new Error("The GitHub prerelease flag must match the semantic release version.");
  }

  // The legacy stable endpoint may still contain beta.5 before 0.1.0 is published.
  const officialStable = stable && !versionParts(stable.version).prerelease.length ? stable : null;
  const nextStable = newest(officialStable, isPrerelease ? null : incoming);
  const nextBeta = newest(beta, stable, incoming);
  return {
    stable: nextStable && nextStable !== stable ? nextStable : null,
    beta: nextBeta && nextBeta !== beta ? nextBeta : null,
  };
}
