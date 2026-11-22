import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReleaseManifest } from "./update-feed.mjs";
import { verifyUpdaterSignature } from "./updater-signature.mjs";
import { versionFromReleaseTag } from "./version.mjs";

// node scripts/release/verify-updater-manifest.mjs <latest.json> <tag> <archive> <release.json>
//
// Runs in the release workflow on the draft, before anyone can publish it.
// The archive is the one built on the runner. release.json is the output of
// `gh release view <tag> --json assets`.

/**
 * Prove that an installed copy will accept this update: every signature in the
 * manifest verifies the runner-built archive with the committed public key and
 * was made for the announced version, and the manifest downloads an archive of
 * this release.
 */
export function verifyUpdaterManifest({ manifest, tag, assets, archive, archiveSignature, publicKey }) {
  validateReleaseManifest({ manifest, tag, assets });
  const version = versionFromReleaseTag(tag);
  const signatures = new Set([archiveSignature, ...Object.values(manifest.platforms).map((entry) => entry.signature)]);
  for (const signature of signatures) {
    const verified = verifyUpdaterSignature({ data: archive, signature, publicKey });
    if (verified.version !== version) {
      throw new Error(`The updater archive is signed for version ${verified.version ?? "(none)"}, not ${version}.`);
    }
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestPath, tag, archivePath, releasePath] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (!manifestPath || !tag || !archivePath || !releasePath) {
    throw new Error("Usage: verify-updater-manifest.mjs <latest.json> <tag> <archive> <release.json>");
  }
  const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tauriConfig = JSON.parse(await readFile(join(rootDirectory, "src-tauri", "tauri.conf.json"), "utf8"));
  const version = verifyUpdaterManifest({
    manifest: JSON.parse(await readFile(manifestPath, "utf8")),
    tag,
    assets: JSON.parse(await readFile(releasePath, "utf8")).assets,
    archive: await readFile(archivePath),
    archiveSignature: (await readFile(`${archivePath}.sig`, "utf8")).trim(),
    publicKey: tauriConfig.plugins.updater.pubkey,
  });
  console.log(`The update manifest for ${version} is signed for that version with the committed key and downloads this release's archive.`);
}
