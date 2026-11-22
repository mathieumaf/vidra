import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertEngineMatchesRecipe,
  assertEnginePinned,
  downloadEngine,
  engineArchiveRoot,
  engineMarkerPath,
  exportCorrespondingSources,
  installEngineBinaries,
  localBuildMarker,
  readEnginePin,
} from "./engine.mjs";
import { recipeFingerprint } from "./recipe.mjs";
import { hostTargetTriple, recipeEntry } from "./target.mjs";
import { ffmpegVersionMatches } from "./version.mjs";

// pnpm ffmpeg:prepare                               install the pinned engine archive
// pnpm ffmpeg:prepare -- --build                    compile the recipe on this machine instead
// pnpm ffmpeg:prepare -- --export-sources <folder>  also write the archive's corresponding sources

const USAGE = "Usage: node scripts/ffmpeg/prepare.mjs [--build | --export-sources <folder>]";
const options = parseArguments(process.argv.slice(2));

if (options.build) {
  await import("./build.mjs");
  process.exit(0);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, "..", "..");
const target = hostTargetTriple();
const binaryDirectory = join(rootDirectory, "src-tauri", "binaries");
const manifest = JSON.parse(await readFile(join(scriptDirectory, "sources.json"), "utf8"));
const recipe = recipeEntry(manifest, target);
const expectedVersion = recipe.sources.ffmpeg.version;
const markerPath = engineMarkerPath(binaryDirectory, target);
// On a GitHub runner the sidecars always come out of the verified archive.
// Whatever is already in src-tauri/binaries, a marker included, is ignored
// there, so nothing but the pinned archive can reach a release.
const trustInstalled = process.env.CI !== "true";
const marker = trustInstalled ? await readOptional(markerPath) : "";

// An engine compiled here from the current recipe stays in place, so a recipe
// change can be developed before its archive is published.
if (!options.exportSources && marker === localBuildMarker(recipeFingerprint(recipe)) && sidecarsReport(expectedVersion)) {
  console.log(`FFmpeg ${expectedVersion}, compiled on this machine, is ready for ${target}.`);
  process.exit(0);
}

const pin = await readEnginePin();
assertEnginePinned(pin);
assertEngineMatchesRecipe(pin, recipe);
if (pin.target !== target) {
  throw new Error(`The engine archive is built for ${pin.target}, not ${target}.`);
}

const archivePath = join(rootDirectory, ".cache", "ffmpeg", target, pin.archiveName);
await downloadEngine(pin, archivePath);

if (marker !== "" && marker === pin.sha256 && sidecarsReport(expectedVersion)) {
  console.log(`FFmpeg ${expectedVersion} is ready for ${target}.`);
} else {
  await installEngineBinaries({
    archivePath,
    root: engineArchiveRoot(pin),
    binaryDirectory,
    target,
    expectedVersion,
    sign: signExecutable,
  });
  await writeFile(markerPath, `${pin.sha256}\n`);
  console.log(`FFmpeg ${expectedVersion} is ready for ${target}.`);
}

if (options.exportSources) {
  const files = await exportCorrespondingSources({
    archivePath,
    root: engineArchiveRoot(pin),
    recipe,
    outputDirectory: resolve(options.exportSources),
  });
  console.log(`Wrote ${files.length} corresponding-source files to ${resolve(options.exportSources)}.`);
}

function parseArguments(argv) {
  const parsed = { build: false, exportSources: "" };
  const args = argv.filter((argument) => argument !== "--");
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--build") {
      parsed.build = true;
    } else if (args[index] === "--export-sources" && args[index + 1]) {
      parsed.exportSources = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument ${args[index]}. ${USAGE}`);
    }
  }
  if (parsed.build && parsed.exportSources) {
    throw new Error(`A local build writes its sources to release-assets/ffmpeg-sources. ${USAGE}`);
  }
  return parsed;
}

function sidecarsReport(version) {
  return ["ffmpeg", "ffprobe"].every((name) => {
    const result = spawnSync(join(binaryDirectory, `${name}-${target}`), ["-version"], { encoding: "utf8" });
    return result.status === 0 && ffmpegVersionMatches(result.stdout ?? "", version);
  });
}

// The archive's executables are ad-hoc signed again after extraction, so
// macOS runs them from this checkout. A release build signs them with the
// Developer ID certificate when Tauri bundles the application.
function signExecutable(executable, destination) {
  spawnSync("xattr", ["-cr", destination], { stdio: "ignore" });
  const signing = spawnSync("codesign", ["--force", "--sign", "-", destination], { encoding: "utf8" });
  if (signing.status !== 0) {
    throw new Error(`Unable to ad-hoc sign ${executable}: ${signing.stderr}`);
  }
}

async function readOptional(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}
