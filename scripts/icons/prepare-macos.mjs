import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "../..");
const sourceDocument = join(rootDirectory, "src-tauri/icons/Vidra.icon");
const outputDirectory = join(rootDirectory, "src-tauri/generated/macos-icon");
const compiledIcon = join(outputDirectory, "Vidra.icns");
const compiledAssets = join(outputDirectory, "Assets.car");
const partialInfoPlist = join(outputDirectory, "icon-info.plist");

if (process.platform !== "darwin") {
  console.log("Skipping Icon Composer assets outside macOS.");
  process.exit(0);
}

if (!existsSync(sourceDocument)) {
  throw new Error(`Missing Icon Composer document: ${sourceDocument}`);
}

function newestModificationTime(path) {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;

  return readdirSync(path).reduce(
    (newest, entry) => Math.max(newest, newestModificationTime(join(path, entry))),
    stats.mtimeMs,
  );
}

const outputsAreCurrent =
  existsSync(compiledIcon) &&
  existsSync(compiledAssets) &&
  existsSync(partialInfoPlist) &&
  Math.min(
    statSync(compiledIcon).mtimeMs,
    statSync(compiledAssets).mtimeMs,
    statSync(partialInfoPlist).mtimeMs,
  ) >= newestModificationTime(sourceDocument);

if (outputsAreCurrent) {
  console.log("Icon Composer assets are ready.");
  process.exit(0);
}

const defaultDeveloperDirectory = "/Applications/Xcode.app/Contents/Developer";
const developerDirectory = process.env.DEVELOPER_DIR ?? defaultDeveloperDirectory;
const xcrun = "/usr/bin/xcrun";

if (!existsSync(developerDirectory)) {
  if (existsSync(compiledIcon) && existsSync(compiledAssets) && existsSync(partialInfoPlist)) {
    console.warn("Xcode is unavailable; using the existing compiled Icon Composer assets.");
    process.exit(0);
  }

  throw new Error("Xcode 26 or later is required to compile Vidra.icon.");
}

mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(
  xcrun,
  [
    "actool",
    sourceDocument,
    "--compile",
    outputDirectory,
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "10.13",
    "--target-device",
    "mac",
    "--app-icon",
    "Vidra",
    "--bundle-identifier",
    "io.github.mathieumaf.vidra",
    "--output-partial-info-plist",
    partialInfoPlist,
    "--output-format",
    "human-readable-text",
    "--notices",
    "--warnings",
  ],
  {
    cwd: rootDirectory,
    env: { ...process.env, DEVELOPER_DIR: developerDirectory },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Unable to compile Icon Composer assets (exit code ${result.status}).`);
}

console.log("Compiled Vidra.icon for macOS.");
