import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installDevelopmentSidecars } from "./development-override.mjs";
import { developmentEntry, hostTargetTriple, rejectReleaseDevelopmentOverride } from "./target.mjs";
import { ffmpegVersionMatches, pinnedReleaseFfmpegVersion } from "./version.mjs";

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

function versionOutput(binary) {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout ?? "";
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
if (development.builtFrom !== "release-recipe") {
  throw new Error(`The ${target} development sidecar must be built from the release recipe.`);
}

await import("./build-release.mjs");
