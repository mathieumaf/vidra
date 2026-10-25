import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractArchiveEntry } from "./archive.mjs";
import { developmentOverrideMarker, installDevelopmentSidecars } from "./development-override.mjs";
import { developmentEntry, hostTargetTriple, rejectReleaseDevelopmentOverride } from "./target.mjs";
import { ffmpegVersionMatches, ffmpegVersionToken, pinnedReleaseFfmpegVersion } from "./version.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, "..", "..");
const overrideDirectory = process.env.VIDRA_FFMPEG_DIR?.trim() ?? "";

rejectReleaseDevelopmentOverride(process.env.VIDRA_FFMPEG_MODE, overrideDirectory);

if (process.env.VIDRA_FFMPEG_MODE === "release") {
  await import("./build-release.mjs");
  process.exit(0);
}

const target = hostTargetTriple();
const binaryDirectory = join(rootDirectory, "src-tauri", "binaries");
const manifest = JSON.parse(await readFile(join(scriptDirectory, "sources.json"), "utf8"));
const expectedVersion = pinnedReleaseFfmpegVersion(manifest);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function versionOutput(binary) {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout ?? "";
}

function requirePinnedVersion(name, binary, expected) {
  const output = versionOutput(binary);
  if (!output) {
    throw new Error(`Unable to read the ${name} version.`);
  }
  if (!ffmpegVersionMatches(output, expected)) {
    const reported = ffmpegVersionToken(output) || "an unrecognized version";
    throw new Error(`${name} reported ${reported}, which does not match the pinned ${expected} engine.`);
  }
}

function signExecutable(executable, destination) {
  spawnSync("xattr", ["-cr", destination], { stdio: "ignore" });
  const signing = spawnSync("codesign", ["--force", "--sign", "-", destination], {
    encoding: "utf8"
  });
  if (signing.status !== 0) {
    throw new Error(`Unable to ad-hoc sign ${executable}: ${signing.stderr}`);
  }
}

async function ensureArchive(artifact, destination) {
  if ((await exists(destination)) && (await sha256(destination)) === artifact.sha256) {
    return;
  }

  await rm(destination, { force: true });
  console.log(`Downloading FFmpeg ${expectedVersion} for ${target}...`);
  await download(artifact.url, destination);
  const digest = await sha256(destination);
  if (digest !== artifact.sha256) {
    await rm(destination, { force: true });
    throw new Error(`Checksum mismatch for ${basename(destination)}: expected ${artifact.sha256}, received ${digest}.`);
  }
}

if (overrideDirectory) {
  await installDevelopmentSidecars({
    sourceDirectory: overrideDirectory,
    target,
    binaryDirectory,
  });
  if (process.platform === "darwin") {
    for (const name of ["ffmpeg", "ffprobe"]) {
      signExecutable(name, join(binaryDirectory, `${name}-${target}`));
    }
  }
  const reports = ["ffmpeg", "ffprobe"].map((name) => versionOutput(join(binaryDirectory, `${name}-${target}`)));
  if (reports.some((report) => !ffmpegVersionMatches(report, expectedVersion))) {
    console.warn(
      `Development FFmpeg override does not match the pinned ${expectedVersion} engine. Vidra will not treat this engine as ready.`
    );
  }
  console.log(`Using local FFmpeg sidecars from ${overrideDirectory} for ${target}.`);
  process.exit(0);
}

const development = developmentEntry(manifest, target);
if (development.version !== expectedVersion) {
  throw new Error(
    `Development FFmpeg ${development.version} does not match the release FFmpeg ${expectedVersion}.`
  );
}
if (!development.archive?.url || !development.archive?.sha256) {
  throw new Error(`The ${target} development sidecar is missing its archive checksum.`);
}

const cacheDirectory = join(rootDirectory, ".cache", "ffmpeg", target);
await mkdir(cacheDirectory, { recursive: true });
await mkdir(binaryDirectory, { recursive: true });
await rm(developmentOverrideMarker(binaryDirectory, target), { force: true });

const archive = join(cacheDirectory, basename(new URL(development.archive.url).pathname));
await ensureArchive(development.archive, archive);

for (const [name, artifact] of Object.entries(development.binaries)) {
  const destination = join(binaryDirectory, `${name}-${target}`);
  const marker = join(binaryDirectory, `.${name}-${target}.sha256`);
  const markerMatches =
    (await exists(marker)) &&
    (await readFile(marker, "utf8")).trim() === artifact.binarySha256;

  // The checksum is of the archived executable, before ad-hoc signing.
  // Signing rewrites the file, so a later run trusts the marker instead of hashing the signed bytes.
  if ((await exists(destination)) && markerMatches) {
    try {
      requirePinnedVersion(name, destination, development.version);
      console.log(`${name} ${development.version} is ready for ${target}.`);
      continue;
    } catch (error) {
      console.warn(`${error instanceof Error ? error.message : error} Reinstalling ${name}.`);
    }
  }

  if (!artifact.archivePath || !artifact.binarySha256) {
    throw new Error(`The ${target} ${name} sidecar is missing its archive path or checksum.`);
  }

  await extractArchiveEntry(archive, artifact.archivePath, destination);
  const digest = await sha256(destination);
  if (digest !== artifact.binarySha256) {
    await rm(destination, { force: true });
    throw new Error(`Checksum mismatch for ${name}: expected ${artifact.binarySha256}, received ${digest}.`);
  }

  signExecutable(name, destination);
  try {
    requirePinnedVersion(name, destination, development.version);
  } catch (error) {
    await rm(destination, { force: true });
    await rm(marker, { force: true });
    throw error;
  }
  await writeFile(marker, `${artifact.binarySha256}\n`);
  console.log(`${name} ${development.version} is ready for ${target}.`);
}
