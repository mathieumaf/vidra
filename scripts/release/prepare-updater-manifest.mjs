import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function versionFromReleaseTag(tag) {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const match = version.match(SEMVER);
  const hasInvalidNumericPrerelease = match?.[4]?.split(".").some((identifier) => (
    /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")
  ));
  if (!match || hasInvalidNumericPrerelease) {
    throw new Error(`Release tag ${tag} is not a valid semantic version.`);
  }
  return version;
}

export function prepareUpdaterManifest(manifest, tag) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The updater manifest must be a JSON object.");
  }
  if (!manifest.platforms || typeof manifest.platforms !== "object") {
    throw new Error("The updater manifest does not contain any platform artifacts.");
  }

  const platforms = Object.values(manifest.platforms);
  if (platforms.length === 0 || platforms.some((platform) => (
    !platform || typeof platform !== "object"
    || typeof platform.url !== "string"
    || typeof platform.signature !== "string"
  ))) {
    throw new Error("Every updater platform must contain a download URL and signature.");
  }

  return { ...manifest, version: versionFromReleaseTag(tag) };
}

async function main() {
  const [manifestPath, tag] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (!manifestPath || !tag) {
    throw new Error("Usage: prepare-updater-manifest.mjs <latest.json> <release-tag>");
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const prepared = prepareUpdaterManifest(manifest, tag);
  await writeFile(manifestPath, `${JSON.stringify(prepared, null, 2)}\n`);
  console.log(`Prepared updater manifest for ${prepared.version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
