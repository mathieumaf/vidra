import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertDevArchiveMatchesRecipe,
  assertDevArchivePinned,
  downloadDevArchive,
  installDevArchiveBinaries,
  readDevArchivePin,
} from "./dev-archive.mjs";
import { developmentOverrideMarker, installDevelopmentSidecars } from "./development-override.mjs";
import { developmentEntry, hostTargetTriple, rejectReleaseDevelopmentOverride, releaseEntry } from "./target.mjs";
import { ffmpegVersionMatches, pinnedReleaseFfmpegVersion } from "./version.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, "..", "..");
const overrideDirectory = process.env.VIDRA_FFMPEG_DIR?.trim() ?? "";
const buildRequested = process.argv.includes("--build") || process.env.VIDRA_FFMPEG_MODE === "release";

rejectReleaseDevelopmentOverride(process.env.VIDRA_FFMPEG_MODE, overrideDirectory);
if (buildRequested && overrideDirectory) {
  throw new Error(
    "VIDRA_FFMPEG_DIR cannot be used when compiling FFmpeg. A source build must use the pinned release recipe.",
  );
}

if (buildRequested) {
  await import("./build-release.mjs");
  process.exit(0);
}

const target = hostTargetTriple();
const binaryDirectory = join(rootDirectory, "src-tauri", "binaries");
const manifest = JSON.parse(await readFile(join(scriptDirectory, "sources.json"), "utf8"));
const expectedVersion = pinnedReleaseFfmpegVersion(manifest);

function versionOutput(binary) {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout ?? "";
}

function signExecutable(executable, destination) {
  spawnSync("xattr", ["-cr", destination], { stdio: "ignore" });
  const signing = spawnSync("codesign", ["--force", "--sign", "-", destination], {
    encoding: "utf8",
  });
  if (signing.status !== 0) {
    throw new Error(`Unable to ad-hoc sign ${executable}: ${signing.stderr}`);
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
      `Development FFmpeg override does not match the pinned ${expectedVersion} engine. Vidra will not treat this engine as ready.`,
    );
  }
  console.log(`Using local FFmpeg sidecars from ${overrideDirectory} for ${target}.`);
  process.exit(0);
}

const development = developmentEntry(manifest, target);
if (development.version !== expectedVersion) {
  throw new Error(
    `Development FFmpeg ${development.version} does not match the release FFmpeg ${expectedVersion}.`,
  );
}
if (development.distribution !== "dev-archive") {
  throw new Error(`The ${target} development sidecar must be downloaded from the pinned development archive.`);
}

const pin = await readDevArchivePin();
assertDevArchivePinned(pin);
assertDevArchiveMatchesRecipe(pin, releaseEntry(manifest, pin.target));
if (pin.target !== target) {
  throw new Error(`The development archive is built for ${pin.target}, not ${target}.`);
}

const cacheDirectory = join(rootDirectory, ".cache", "ffmpeg", target);
const archivePath = join(cacheDirectory, pin.archiveName);
const markerPath = join(binaryDirectory, `.ffmpeg-dev-archive-${target}.sha256`);
const marker = await readOptional(markerPath);
const ready = marker === pin.sha256 && ["ffmpeg", "ffprobe"].every((name) => {
  const binary = join(binaryDirectory, `${name}-${target}`);
  return ffmpegVersionMatches(versionOutput(binary), expectedVersion);
});
if (ready) {
  console.log(`FFmpeg ${expectedVersion} is ready for ${target}.`);
  process.exit(0);
}

await downloadDevArchive(pin, archivePath);
await rm(developmentOverrideMarker(binaryDirectory, target), { force: true });
for (const name of ["ffmpeg", "ffprobe"]) {
  await rm(join(binaryDirectory, `.${name}-${target}.sha256`), { force: true });
}
await installDevArchiveBinaries({
  archivePath,
  binaryDirectory,
  target,
  expectedVersion,
  sign: process.platform === "darwin" ? signExecutable : async () => {},
});
await writeFile(markerPath, `${pin.sha256}\n`);
console.log(`FFmpeg ${expectedVersion} is ready for ${target}.`);

async function readOptional(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}
