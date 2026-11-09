import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSignedVersionsMatch, verifyUpdaterSignature } from "./updater-signature.mjs";

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

export function validateUpdaterManifest(manifest) {
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
  return platforms;
}

// The build signs the updater archive for the bundle version, which omits the
// prerelease suffix. The release workflow re-signs that archive for the exact
// tag version; this places the replacement signature in the manifest and
// refuses any platform whose signed version still differs from the
// announced one.
export function prepareUpdaterManifest(manifest, tag, signature) {
  const platforms = validateUpdaterManifest(manifest);
  if (typeof signature !== "string" || !signature.trim()) {
    throw new Error("A signature bound to the release tag is required.");
  }
  if (new Set(platforms.map((platform) => platform.url)).size !== 1) {
    throw new Error("Every updater platform must point to the same updater archive.");
  }

  const prepared = {
    ...manifest,
    version: versionFromReleaseTag(tag),
    platforms: Object.fromEntries(Object.entries(manifest.platforms).map(([name, platform]) => (
      [name, { ...platform, signature: signature.trim() }]
    ))),
  };
  assertSignedVersionsMatch(prepared);
  return prepared;
}

async function main() {
  const [manifestPath, tag, archivePath] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (!manifestPath || !tag || !archivePath) {
    throw new Error("Usage: prepare-updater-manifest.mjs <latest.json> <release-tag> <updater-archive>");
  }

  const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tauriManifest = JSON.parse(await readFile(join(rootDirectory, "src-tauri", "tauri.conf.json"), "utf8"));
  const signature = await readFile(`${archivePath}.sig`, "utf8");
  verifyUpdaterSignature({
    data: await readFile(archivePath),
    signature,
    publicKey: tauriManifest.plugins.updater.pubkey,
  });

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const prepared = prepareUpdaterManifest(manifest, tag, signature);
  await writeFile(manifestPath, `${JSON.stringify(prepared, null, 2)}\n`);
  console.log(`Prepared updater manifest for ${prepared.version} with a verified signature bound to that version.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
