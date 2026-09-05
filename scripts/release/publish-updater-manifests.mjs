import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelPromotions } from "./update-channels.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.RELEASE_TAG;
if (!repository || !tag) throw new Error("GITHUB_REPOSITORY and RELEASE_TAG are required.");
if (tag === "updater-manifest") throw new Error("The rolling manifest is not an application release.");

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

const published = release(tag);
if (published.draft) throw new Error("Draft releases cannot be offered as application updates.");
const rolling = release("updater-manifest", true);
if (rolling?.draft) throw new Error("The rolling manifest release must be published.");
const directory = await mkdtemp(join(tmpdir(), "vidra-updater-channels-"));

async function download(releaseTag, asset, subdirectory) {
  const destination = join(directory, subdirectory);
  gh("release", "download", releaseTag, "--repo", repository, "--pattern", asset, "--dir", destination);
  return JSON.parse(await readFile(join(destination, asset), "utf8"));
}

try {
  const incoming = await download(tag, "latest.json", "incoming");
  const current = {};
  for (const [channel, asset] of [["stable", "latest.json"], ["beta", "beta.json"]]) {
    current[channel] = rolling?.assets.some((item) => item.name === asset)
      ? await download("updater-manifest", asset, channel)
      : null;
  }
  const promotions = channelPromotions({ incoming, tag, prerelease: published.prerelease, ...current });
  const uploads = [];
  for (const [channel, asset] of [["stable", "latest.json"], ["beta", "beta.json"]]) {
    if (!promotions[channel]) continue;
    const path = join(directory, asset);
    await writeFile(path, `${JSON.stringify(promotions[channel], null, 2)}\n`);
    uploads.push(path);
    console.log(`Promoting ${channel} to ${promotions[channel].version}.`);
  }
  if (uploads.length > 0) {
    if (rolling) {
      gh("release", "upload", "updater-manifest", ...uploads, "--repo", repository, "--clobber");
    } else {
      gh("release", "create", "updater-manifest", ...uploads, "--repo", repository,
        "--target", published.target_commitish, "--title", "Vidra updater manifests",
        "--notes", "Mutable manifests for Vidra's Stable and Beta update channels.", "--prerelease");
    }
  } else {
    console.log("Both update channels already point to an equal or newer release.");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
