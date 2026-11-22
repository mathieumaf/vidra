import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublishedOfficialRelease,
  assertReleaseComplete,
  FEED_ASSETS,
  FEED_RELEASE_TAG,
  feedUpdate,
  validateReleaseManifest,
} from "./update-feed.mjs";
import { verifyUpdaterSignature } from "./updater-signature.mjs";
import { versionFromReleaseTag } from "./version.mjs";

// Runs when a release is published. It copies that release's manifest into the
// update feed, which is what makes installed copies offer the update.

const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.RELEASE_TAG;
if (!repository || !tag) throw new Error("GITHUB_REPOSITORY and RELEASE_TAG are required.");
// The feed's own release and the FFmpeg engine releases are not application
// releases. Refuse them before asking GitHub anything.
versionFromReleaseTag(tag);

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function release(releaseTag, allowMissing = false) {
  try {
    return JSON.parse(gh("api", `repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`));
  } catch (error) {
    if (allowMissing && error.stderr?.toString().includes("(HTTP 404)")) return null;
    throw error;
  }
}

const directory = await mkdtemp(join(tmpdir(), "vidra-update-feed-"));
// VIDRA_TAURI_CONFIG lets the tests supply a configuration with a test key.
const tauriConfigPath = process.env.VIDRA_TAURI_CONFIG
  ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri", "tauri.conf.json");

async function download(releaseTag, asset, subdirectory) {
  const destination = join(directory, subdirectory);
  gh("release", "download", releaseTag, "--repo", repository, "--pattern", asset, "--dir", destination);
  return JSON.parse(await readFile(join(destination, asset), "utf8"));
}

// An installed copy refuses an update whose signature does not verify its
// archive. Check that here, with the public key the app ships, so the feed
// never offers an update that cannot be installed.
async function verifyArchiveSignatures(manifest, assets) {
  const archives = assets.filter((asset) => asset.name.endsWith(".app.tar.gz"));
  if (archives.length !== 1) {
    throw new Error(`Release ${tag} must have exactly one updater archive, found ${archives.length}.`);
  }
  const destination = join(directory, "archive");
  gh("release", "download", tag, "--repo", repository, "--pattern", archives[0].name, "--dir", destination);
  const data = await readFile(join(destination, archives[0].name));
  const publicKey = JSON.parse(await readFile(tauriConfigPath, "utf8")).plugins.updater.pubkey;
  for (const entry of Object.values(manifest.platforms)) {
    verifyUpdaterSignature({ data, signature: entry.signature, publicKey });
  }
}

try {
  const published = release(tag);
  assertPublishedOfficialRelease(published, tag);
  assertReleaseComplete(published.assets, tag);
  const incoming = validateReleaseManifest({
    manifest: await download(tag, "latest.json", "incoming"),
    tag,
    assets: published.assets,
  });
  await verifyArchiveSignatures(incoming, published.assets);

  const feed = release(FEED_RELEASE_TAG, true);
  if (feed?.draft) throw new Error("The update feed release must be published.");

  const current = {};
  for (const asset of FEED_ASSETS) {
    current[asset] = feed?.assets.some((item) => item.name === asset)
      ? await download(FEED_RELEASE_TAG, asset, `current-${asset}`)
      : null;
  }
  const { target, assets } = feedUpdate(incoming, current);
  if (target !== incoming) {
    console.log(`The update feed already offers ${target.version}, which is newer than ${incoming.version}.`);
  }

  const uploads = [];
  for (const asset of assets) {
    const path = join(directory, asset);
    await writeFile(path, `${JSON.stringify(target, null, 2)}\n`);
    uploads.push(path);
    console.log(`${asset} moves from ${current[asset]?.version ?? "nothing"} to ${target.version}.`);
  }

  if (uploads.length === 0) {
    console.log("The update feed already offers an equal or newer release.");
  } else if (feed) {
    gh("release", "upload", FEED_RELEASE_TAG, ...uploads, "--repo", repository, "--clobber");
  } else {
    gh("release", "create", FEED_RELEASE_TAG, ...uploads, "--repo", repository,
      "--target", published.target_commitish, "--title", "Vidra update feed",
      "--notes", "The update feed that installed copies of Vidra read. It is not an application release.",
      "--prerelease");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
