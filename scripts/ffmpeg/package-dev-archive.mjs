import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevArchiveMatchesRecipe, DEV_ARCHIVE_ROOT, devArchivePinPath, sha256 } from "./dev-archive.mjs";
import { BUILD_RECIPE_VERSION } from "./recipe.mjs";
import { releaseEntry } from "./target.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, "..", "..");

export async function packageDevArchive({
  binaryDirectory,
  target,
  sourceAssetDirectory,
  noticesPath,
  recipeFiles,
  outputDirectory,
  pin,
}) {
  for (const name of ["ffmpeg", "ffprobe"]) {
    await access(join(binaryDirectory, `${name}-${target}`));
  }
  const sourceEntries = await readdir(sourceAssetDirectory);
  if (!sourceEntries.includes("SHA256SUMS") || !sourceEntries.includes("BUILD_CONFIGURATION.txt")) {
    throw new Error("Corresponding sources must include SHA256SUMS and BUILD_CONFIGURATION.txt.");
  }
  const sourceArchives = sourceEntries.filter((name) => (
    name !== "SHA256SUMS" && name !== "BUILD_CONFIGURATION.txt"
  ));
  if (sourceArchives.length === 0) {
    throw new Error("Corresponding source archives are missing. Refusing to package binaries alone.");
  }

  const stagingParent = join(outputDirectory, ".staging");
  const staging = join(stagingParent, DEV_ARCHIVE_ROOT);
  await rm(stagingParent, { recursive: true, force: true });
  await mkdir(join(staging, "corresponding-sources"), { recursive: true });
  await mkdir(join(staging, "build-recipe"), { recursive: true });

  for (const name of ["ffmpeg", "ffprobe"]) {
    await copyFile(join(binaryDirectory, `${name}-${target}`), join(staging, name));
  }
  for (const name of sourceEntries) {
    await copyFile(join(sourceAssetDirectory, name), join(staging, "corresponding-sources", name));
  }
  await copyFile(noticesPath, join(staging, "THIRD_PARTY_NOTICES.md"));
  for (const [name, path] of Object.entries(recipeFiles)) {
    await copyFile(path, join(staging, "build-recipe", name));
  }
  await writeFile(join(staging, "NOTICE.txt"), noticeText(pin));

  await mkdir(outputDirectory, { recursive: true });
  const archivePath = join(outputDirectory, pin.archiveName);
  await rm(archivePath, { force: true });
  const packed = spawnSync("tar", ["-cJf", archivePath, "-C", stagingParent, DEV_ARCHIVE_ROOT], {
    encoding: "utf8",
  });
  if (packed.status !== 0) {
    throw new Error(`Unable to create the development archive: ${packed.stderr || "tar failed"}`);
  }
  await rm(stagingParent, { recursive: true, force: true });

  const digest = await sha256(archivePath);
  const sha256Path = `${archivePath}.sha256`;
  await writeFile(sha256Path, `${digest}  ${pin.archiveName}\n`);
  return { archivePath, sha256Path, sha256: digest };
}

function noticeText(pin) {
  return [
    "Vidra FFmpeg development sidecar",
    `FFmpeg version: ${pin.version}`,
    `Recipe: ${pin.recipeVersion}`,
    `Target: ${pin.target}`,
    `Recipe fingerprint: ${pin.recipeFingerprint}`,
    "",
    "These executables are a development copy of Vidra's GPL-enabled release build.",
    "FFmpeg is GPL-2.0-or-later when built with the GPL components in this recipe, including libx264 and libx265.",
    "",
    "The corresponding source archives, their SHA-256 checksums, and the configure arguments are in corresponding-sources/.",
    "Those archives are the pinned inputs recorded in build-recipe/sources.json. No local patches are applied.",
    "The commands that compile them are in build-recipe/build-release.mjs.",
    "License summaries are in THIRD_PARTY_NOTICES.md. The license texts are inside the source archives.",
    "",
    "This archive is not a Vidra application release and it is not an application update.",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pin = JSON.parse(await readFile(devArchivePinPath(), "utf8"));
  const manifest = JSON.parse(await readFile(join(scriptDirectory, "sources.json"), "utf8"));
  if (pin.recipeVersion !== BUILD_RECIPE_VERSION) {
    throw new Error(`dev-archive.json recipe ${pin.recipeVersion} does not match recipe ${BUILD_RECIPE_VERSION}.`);
  }
  assertDevArchiveMatchesRecipe(pin, releaseEntry(manifest, pin.target));
  const packaged = await packageDevArchive({
    binaryDirectory: join(rootDirectory, "src-tauri", "binaries"),
    target: pin.target,
    sourceAssetDirectory: join(rootDirectory, "release-assets", "ffmpeg-sources"),
    noticesPath: join(rootDirectory, "THIRD_PARTY_NOTICES.md"),
    recipeFiles: {
      "build-release.mjs": join(scriptDirectory, "build-release.mjs"),
      "sources.json": join(scriptDirectory, "sources.json"),
      "recipe.mjs": join(scriptDirectory, "recipe.mjs"),
    },
    outputDirectory: join(rootDirectory, "release-assets", "dev-archive"),
    pin,
  });
  console.log(`${packaged.sha256}  ${packaged.archivePath}`);
}
