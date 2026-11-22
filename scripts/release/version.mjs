// Vidra publishes official releases only. A release tag is `v` followed by
// the exact application version, such as v0.2.0.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parse(version) {
  const match = typeof version === "string" ? version.match(SEMVER) : null;
  const prerelease = match?.[4]?.split(".") ?? [];
  const leadingZero = prerelease.some((identifier) => /^0\d+$/.test(identifier));
  if (!match || leadingZero) {
    throw new Error(`${JSON.stringify(version)} is not a valid semantic version.`);
  }
  return { core: [match[1], match[2], match[3]].map(BigInt), prerelease, official: !version.includes("-") && !version.includes("+") };
}

/** True for a plain X.Y.Z version: no prerelease suffix and no build metadata. */
export function isOfficialVersion(version) {
  return parse(version).official;
}

/** The application version a release tag names. Only `vX.Y.Z` is a release tag. */
export function versionFromReleaseTag(tag) {
  const version = typeof tag === "string" && tag.startsWith("v") ? tag.slice(1) : "";
  let official = false;
  try {
    official = isOfficialVersion(version);
  } catch {
    official = false;
  }
  if (!official) {
    throw new Error(`${JSON.stringify(tag)} is not a release tag. Vidra release tags are vX.Y.Z, with no prerelease suffix.`);
  }
  return version;
}

/**
 * Semantic version precedence: negative, zero, or positive. Prerelease
 * versions are understood because the update feed may still hold one that was
 * published before Vidra stopped making them.
 */
export function compareVersions(left, right) {
  const a = parse(left);
  const b = parse(right);
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
