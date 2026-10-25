import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { releaseRecipeFingerprint } from "./recipe.mjs";
import { ffmpegVersionMatches, ffmpegVersionToken } from "./version.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const DEV_ARCHIVE_SHA256_PLACEHOLDER = "placeholder";
export const DEV_ARCHIVE_ROOT = "vidra-ffmpeg-dev";

export function devArchivePinPath() {
  return join(scriptDirectory, "dev-archive.json");
}

export async function readDevArchivePin() {
  return JSON.parse(await readFile(devArchivePinPath(), "utf8"));
}

export function isDevArchivePlaceholder(pin) {
  return pin?.sha256 === DEV_ARCHIVE_SHA256_PLACEHOLDER;
}

export function devArchivePlaceholderError(pin) {
  const version = pin?.version ?? "pinned";
  return [
    `The FFmpeg ${version} development archive checksum in scripts/ffmpeg/dev-archive.json is still "${DEV_ARCHIVE_SHA256_PLACEHOLDER}".`,
    "pnpm ffmpeg:prepare does not compile FFmpeg.",
    "A maintainer runs the FFmpeg development archive workflow, then a follow-up commit replaces the placeholder with the published archive SHA-256.",
    "To compile on this machine instead, run pnpm ffmpeg:prepare -- --build.",
  ].join(" ");
}

export function assertDevArchivePinned(pin) {
  if (isDevArchivePlaceholder(pin)) {
    throw new Error(devArchivePlaceholderError(pin));
  }
  if (typeof pin?.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(pin.sha256)) {
    throw new Error("The development archive checksum must be a 64-character SHA-256 hex string.");
  }
}

export function assertDevArchiveMatchesRecipe(pin, release) {
  const fingerprint = releaseRecipeFingerprint(release);
  if (pin.recipeFingerprint !== fingerprint) {
    throw new Error(
      `The development archive fingerprint does not match the current release recipe. Expected ${fingerprint}.`,
    );
  }
  if (pin.version !== release?.sources?.ffmpeg?.version) {
    throw new Error(
      `The development archive version ${pin.version} does not match release FFmpeg ${release?.sources?.ffmpeg?.version}.`,
    );
  }
}

export function requiredDevArchiveMembers() {
  return [
    `${DEV_ARCHIVE_ROOT}/ffmpeg`,
    `${DEV_ARCHIVE_ROOT}/ffprobe`,
    `${DEV_ARCHIVE_ROOT}/NOTICE.txt`,
    `${DEV_ARCHIVE_ROOT}/THIRD_PARTY_NOTICES.md`,
    `${DEV_ARCHIVE_ROOT}/corresponding-sources/SHA256SUMS`,
    `${DEV_ARCHIVE_ROOT}/corresponding-sources/BUILD_CONFIGURATION.txt`,
    `${DEV_ARCHIVE_ROOT}/build-recipe/build-release.mjs`,
    `${DEV_ARCHIVE_ROOT}/build-recipe/sources.json`,
    `${DEV_ARCHIVE_ROOT}/build-recipe/recipe.mjs`,
  ];
}

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function downloadDevArchive(pin, destination) {
  assertDevArchivePinned(pin);
  await mkdir(dirname(destination), { recursive: true });
  if ((await exists(destination)) && (await sha256(destination)) === pin.sha256) return;

  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  await rm(destination, { force: true });
  console.log(`Downloading FFmpeg ${pin.version} development archive...`);
  const response = await fetch(pin.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${pin.url}: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  const digest = await sha256(temporary);
  if (digest !== pin.sha256) {
    await rm(temporary, { force: true });
    throw new Error(`Checksum mismatch for ${pin.archiveName}: expected ${pin.sha256}, received ${digest}.`);
  }
  await rename(temporary, destination);
}

export function listArchive(archivePath) {
  const result = spawnSync("tar", ["-tJf", archivePath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Unable to read ${archivePath}: ${result.stderr || "tar failed"}`);
  }
  return result.stdout.split(/\r?\n/).map((line) => line.replace(/^\.\//, "").trim()).filter(Boolean);
}

export function assertArchiveHasCorrespondingSources(entries) {
  const missing = requiredDevArchiveMembers().filter((member) => !entries.includes(member));
  if (missing.length > 0) {
    throw new Error(
      `The development archive is missing GPL corresponding-source files: ${missing.join(", ")}.`,
    );
  }
  const sourceArchives = entries.filter((entry) => (
    entry.startsWith(`${DEV_ARCHIVE_ROOT}/corresponding-sources/`)
    && !entry.endsWith("/")
    && !entry.endsWith("/SHA256SUMS")
    && !entry.endsWith("/BUILD_CONFIGURATION.txt")
  ));
  if (sourceArchives.length === 0) {
    throw new Error("The development archive does not contain the corresponding source archives.");
  }
}

export async function installDevArchiveBinaries({
  archivePath,
  binaryDirectory,
  target,
  expectedVersion,
  sign = async () => {},
}) {
  const entries = listArchive(archivePath);
  assertArchiveHasCorrespondingSources(entries);
  const temporary = join(binaryDirectory, `.ffmpeg-dev-archive-${target}.extract`);
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const members = [`${DEV_ARCHIVE_ROOT}/ffmpeg`, `${DEV_ARCHIVE_ROOT}/ffprobe`];
  const extracted = spawnSync("tar", ["-xJf", archivePath, "-C", temporary, ...members], { encoding: "utf8" });
  if (extracted.status !== 0) {
    await rm(temporary, { recursive: true, force: true });
    throw new Error(`Unable to extract the development archive: ${extracted.stderr || "tar failed"}`);
  }

  await mkdir(binaryDirectory, { recursive: true });
  const installed = [];
  try {
    for (const name of ["ffmpeg", "ffprobe"]) {
      const source = join(temporary, DEV_ARCHIVE_ROOT, name);
      const destination = join(binaryDirectory, `${name}-${target}`);
      await rm(destination, { force: true });
      const copied = spawnSync("cp", ["-p", source, destination], { encoding: "utf8" });
      if (copied.status !== 0) {
        throw new Error(`Unable to install ${name}: ${copied.stderr || "cp failed"}`);
      }
      installed.push(destination);
      await chmod(destination, 0o755);
      await sign(name, destination);
      requireReportedVersion(name, destination, expectedVersion);
    }
  } catch (error) {
    await Promise.all(installed.map((path) => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function requireReportedVersion(name, binary, expectedVersion) {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
  const output = result.status === 0 ? result.stdout ?? "" : "";
  if (!ffmpegVersionMatches(output, expectedVersion)) {
    const reported = ffmpegVersionToken(output) || "an unrecognized version";
    throw new Error(`${name} reported ${reported}, which does not match the pinned ${expectedVersion} engine.`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

