import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPublishedOfficialRelease,
  FEED_ASSETS,
  FEED_RELEASE_TAG,
  feedMovesTo,
  validateReleaseManifest,
} from "./update-feed.mjs";
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

async function download(releaseTag, asset, subdirectory) {
  const destination = join(directory, subdirectory);
  gh("release", "download", releaseTag, "--repo", repository, "--pattern", asset, "--dir", destination);
  return JSON.parse(await readFile(join(destination, asset), "utf8"));
}

try {
  const published = release(tag);
  assertPublishedOfficialRelease(published, tag);
  const incoming = validateReleaseManifest({
    manifest: await download(tag, "latest.json", "incoming"),
    tag,
    assets: published.assets,
  });

  const feed = release(FEED_RELEASE_TAG, true);
  if (feed?.draft) throw new Error("The update feed release must be published.");

  const uploads = [];
  for (const asset of FEED_ASSETS) {
    const current = feed?.assets.some((item) => item.name === asset)
      ? await download(FEED_RELEASE_TAG, asset, `current-${asset}`)
      : null;
    if (!feedMovesTo(incoming, current)) {
      console.log(`${asset} already offers ${current.version}. It stays.`);
      continue;
    }
    const path = join(directory, asset);
    await writeFile(path, `${JSON.stringify(incoming, null, 2)}\n`);
    uploads.push(path);
    console.log(`${asset} moves from ${current?.version ?? "nothing"} to ${incoming.version}.`);
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
