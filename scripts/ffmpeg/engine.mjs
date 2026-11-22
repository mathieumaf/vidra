import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { recipeFingerprint } from "./recipe.mjs";
import { ffmpegVersionMatches, ffmpegVersionToken } from "./version.mjs";

// The engine is the FFmpeg and FFprobe build that Vidra bundles. One archive,
// built from the pinned recipe and published as a GitHub release asset, is
// used everywhere: development, CI, and the application release. Its SHA-256
// is pinned in engine.json, so what CI tests is what ships.

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/** Root folder of a newly packaged archive. An older archive names its own in `archiveRoot`. */
export const ENGINE_ARCHIVE_ROOT = "vidra-ffmpeg";
/** Checksum written in engine.json between a recipe change and the archive's publication. */
export const ENGINE_SHA256_PLACEHOLDER = "placeholder";

export function enginePinPath() {
  return join(scriptDirectory, "engine.json");
}

export async function readEnginePin() {
  return JSON.parse(await readFile(enginePinPath(), "utf8"));
}

export function engineArchiveRoot(pin) {
  return pin?.archiveRoot ?? ENGINE_ARCHIVE_ROOT;
}

/** Records which engine is installed in `src-tauri/binaries`. */
export function engineMarkerPath(binaryDirectory, target) {
  return join(binaryDirectory, `.ffmpeg-engine-${target}.sha256`);
}

/** Marker of an engine compiled on this machine from the recipe with that fingerprint. */
export function localBuildMarker(fingerprint) {
  return `built:${fingerprint}`;
}

export function assertEnginePinned(pin) {
  if (pin?.sha256 === ENGINE_SHA256_PLACEHOLDER) {
    throw new Error([
      `The FFmpeg ${pin?.version ?? "engine"} archive checksum in scripts/ffmpeg/engine.json is still "${ENGINE_SHA256_PLACEHOLDER}".`,
      "A maintainer runs the FFmpeg engine workflow, then replaces the placeholder with the published archive's SHA-256.",
      "Until then, compile the engine on this machine with pnpm ffmpeg:prepare -- --build.",
    ].join(" "));
  }
  if (typeof pin?.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(pin.sha256)) {
    throw new Error("The engine archive checksum must be a 64-character SHA-256 hex string.");
  }
}

export function assertEngineMatchesRecipe(pin, recipe) {
  const fingerprint = recipeFingerprint(recipe);
  if (pin.recipeFingerprint !== fingerprint) {
    throw new Error([
      `The engine archive pinned in scripts/ffmpeg/engine.json was built from another recipe (expected fingerprint ${fingerprint}).`,
      "After a recipe change, compile the engine with pnpm ffmpeg:prepare -- --build until a new archive is published and pinned.",
    ].join(" "));
  }
  if (pin.version !== recipe?.sources?.ffmpeg?.version) {
    throw new Error(
      `The engine archive version ${pin.version} does not match the recipe's FFmpeg ${recipe?.sources?.ffmpeg?.version}.`,
    );
  }
}

export function requiredEngineMembers(root = ENGINE_ARCHIVE_ROOT) {
  return [
    `${root}/ffmpeg`,
    `${root}/ffprobe`,
    `${root}/NOTICE.txt`,
    `${root}/THIRD_PARTY_NOTICES.md`,
    `${root}/corresponding-sources/SHA256SUMS`,
    `${root}/corresponding-sources/BUILD_CONFIGURATION.txt`,
    `${root}/build-recipe/sources.json`,
    `${root}/build-recipe/recipe.mjs`,
  ];
}

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Download the pinned archive, or reuse a cached copy that still matches its checksum. */
export async function downloadEngine(pin, destination) {
  assertEnginePinned(pin);
  await mkdir(dirname(destination), { recursive: true });
  if ((await exists(destination)) && (await sha256(destination)) === pin.sha256) return;

  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  await rm(destination, { force: true });
  console.log(`Downloading the FFmpeg ${pin.version} engine archive...`);
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

/** An engine archive always carries the GPL corresponding sources and the recipe that built it. */
export function assertArchiveComplete(entries, root = ENGINE_ARCHIVE_ROOT) {
  const missing = requiredEngineMembers(root).filter((member) => !entries.includes(member));
  if (missing.length > 0) {
    throw new Error(`The engine archive is missing GPL corresponding-source files: ${missing.join(", ")}.`);
  }
  if (sourceArchiveEntries(entries, root).length === 0) {
    throw new Error("The engine archive does not contain the corresponding source archives.");
  }
  if (!entries.some((entry) => /\/build-recipe\/build[^/]*\.mjs$/.test(entry))) {
    throw new Error("The engine archive does not contain the script that compiled it.");
  }
}

function sourceArchiveEntries(entries, root) {
  const prefix = `${root}/corresponding-sources/`;
  return entries.filter((entry) => (
    entry.startsWith(prefix)
    && !entry.endsWith("/")
    && !entry.endsWith("/SHA256SUMS")
    && !entry.endsWith("/BUILD_CONFIGURATION.txt")
  ));
}

export async function installEngineBinaries({
  archivePath,
  root = ENGINE_ARCHIVE_ROOT,
  binaryDirectory,
  target,
  expectedVersion,
  sign = async () => {},
}) {
  assertArchiveComplete(listArchive(archivePath), root);
  await mkdir(binaryDirectory, { recursive: true });
  const temporary = join(binaryDirectory, `.ffmpeg-engine-${target}.extract`);
  await extract(archivePath, temporary, [`${root}/ffmpeg`, `${root}/ffprobe`]);

  const installed = [];
  try {
    for (const name of ["ffmpeg", "ffprobe"]) {
      const destination = join(binaryDirectory, `${name}-${target}`);
      await rm(destination, { force: true });
      const copied = spawnSync("cp", ["-p", join(temporary, root, name), destination], { encoding: "utf8" });
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

/**
 * Write the archive's source archives, their checksums, and the build
 * configuration into `outputDirectory`, for publication next to an
 * application release. Every source archive must be one the recipe pins, with
 * the pinned SHA-256, and every pinned source must be present. The folder
 * must be new or empty: nothing that is already there is removed.
 */
export async function exportCorrespondingSources({
  archivePath,
  root = ENGINE_ARCHIVE_ROOT,
  recipe,
  outputDirectory,
}) {
  const entries = listArchive(archivePath);
  assertArchiveComplete(entries, root);
  const pinned = new Map(Object.values(recipe.sources).map((source) => [source.archiveName, source.sha256]));
  const sourceNames = sourceArchiveEntries(entries, root).map((entry) => entry.split("/").at(-1));
  const unexpected = sourceNames.filter((name) => !pinned.has(name));
  const absent = [...pinned.keys()].filter((name) => !sourceNames.includes(name));
  if (unexpected.length > 0 || absent.length > 0) {
    throw new Error([
      "The engine archive's sources are not the ones the recipe pins.",
      unexpected.length > 0 ? `Unexpected: ${unexpected.join(", ")}.` : "",
      absent.length > 0 ? `Missing: ${absent.join(", ")}.` : "",
    ].filter(Boolean).join(" "));
  }

  if ((await exists(outputDirectory)) && (await readdir(outputDirectory)).length > 0) {
    throw new Error(`${outputDirectory} is not empty. Export the corresponding sources into a new or empty folder.`);
  }
  const temporary = await mkdtemp(join(tmpdir(), "vidra-engine-sources-"));
  await extract(archivePath, temporary, [`${root}/corresponding-sources`]);
  try {
    const extracted = join(temporary, root, "corresponding-sources");
    for (const [name, expected] of pinned) {
      const digest = await sha256(join(extracted, name));
      if (digest !== expected) {
        throw new Error(`Checksum mismatch for ${name}: the recipe pins ${expected}, the archive holds ${digest}.`);
      }
    }
    await mkdir(outputDirectory, { recursive: true });
    const files = await readdir(extracted);
    for (const name of files) {
      await copyFile(join(extracted, name), join(outputDirectory, name));
    }
    return files.sort();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function extract(archivePath, directory, members) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const extracted = spawnSync("tar", ["-xJf", archivePath, "-C", directory, ...members], { encoding: "utf8" });
  if (extracted.status !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(`Unable to extract the engine archive: ${extracted.stderr || "tar failed"}`);
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
