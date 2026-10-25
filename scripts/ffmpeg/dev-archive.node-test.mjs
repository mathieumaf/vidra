import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertArchiveHasCorrespondingSources,
  assertDevArchiveMatchesRecipe,
  assertDevArchivePinned,
  DEV_ARCHIVE_SHA256_PLACEHOLDER,
  installDevArchiveBinaries,
  isDevArchivePlaceholder,
  listArchive,
  readDevArchivePin,
  requiredDevArchiveMembers,
} from "./dev-archive.mjs";
import { packageDevArchive } from "./package-dev-archive.mjs";
import { BUILD_RECIPE_VERSION, releaseRecipeFingerprint } from "./recipe.mjs";
import { releaseEntry } from "./target.mjs";

const manifest = JSON.parse(await readFile(new URL("./sources.json", import.meta.url), "utf8"));
const release = releaseEntry(manifest, "aarch64-apple-darwin");

test("pins the development archive to the current release recipe", async () => {
  const pin = await readDevArchivePin();
  assert.equal(pin.version, release.sources.ffmpeg.version);
  assert.equal(pin.version, "8.1.3");
  assert.equal(pin.recipeVersion, BUILD_RECIPE_VERSION);
  assert.equal(pin.target, "aarch64-apple-darwin");
  assert.equal(pin.tag, `ffmpeg-dev-${pin.version}-r${pin.recipeVersion}`);
  assert.equal(pin.tag.startsWith("v"), false);
  assert.equal(
    pin.archiveName,
    `vidra-ffmpeg-dev-${pin.version}-${pin.target}-recipe${pin.recipeVersion}.tar.xz`,
  );
  assert.equal(
    pin.url,
    `https://github.com/mathieumaf/vidra/releases/download/${pin.tag}/${pin.archiveName}`,
  );
  assert.equal(pin.recipeFingerprint, releaseRecipeFingerprint(release));
  assert.equal(isDevArchivePlaceholder(pin), true);
  assert.equal(pin.sha256, DEV_ARCHIVE_SHA256_PLACEHOLDER);
  assert.throws(() => assertDevArchivePinned(pin), /does not compile FFmpeg/);
  assert.throws(() => assertDevArchivePinned(pin), /placeholder/);
  assert.doesNotThrow(() => assertDevArchiveMatchesRecipe(pin, release));
});

test("rejects a development archive whose fingerprint is stale", () => {
  const pin = {
    version: "8.1.3",
    recipeFingerprint: "stale",
  };
  assert.throws(() => assertDevArchiveMatchesRecipe(pin, release), /does not match the current release recipe/);
});

test("installs a checksummed archive only when both tools report the pinned version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vidra-dev-archive-"));
  try {
    const pin = {
      ...(await readDevArchivePin()),
      sha256: "ignored-by-the-packager",
    };
    const binaryDirectory = join(directory, "binaries");
    const outputDirectory = join(directory, "out");
    await writeTool(binaryDirectory, "ffmpeg", "8.1.3");
    await writeTool(binaryDirectory, "ffprobe", "8.1.3");
    await writeFile(join(directory, "NOTICE.md"), "notices\n");
    const sourceDirectory = join(directory, "sources");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(join(sourceDirectory, "SHA256SUMS"), "abc  ffmpeg-8.1.3.tar.xz\n");
    await writeFile(join(sourceDirectory, "BUILD_CONFIGURATION.txt"), "recipe\n");
    await writeFile(join(sourceDirectory, "ffmpeg-8.1.3.tar.xz"), "source\n");
    await writeFile(join(directory, "build-release.mjs"), "build\n");
    await writeFile(join(directory, "sources.json"), "{}\n");
    await writeFile(join(directory, "recipe.mjs"), "recipe\n");

    const packaged = await packageDevArchive({
      binaryDirectory,
      target: "aarch64-apple-darwin",
      sourceAssetDirectory: sourceDirectory,
      noticesPath: join(directory, "NOTICE.md"),
      recipeFiles: {
        "build-release.mjs": join(directory, "build-release.mjs"),
        "sources.json": join(directory, "sources.json"),
        "recipe.mjs": join(directory, "recipe.mjs"),
      },
      outputDirectory,
      pin,
    });
    const entries = listArchive(packaged.archivePath);
    assertArchiveHasCorrespondingSources(entries);
    for (const member of requiredDevArchiveMembers()) {
      assert.equal(entries.includes(member), true, member);
    }

    const installed = join(directory, "installed");
    await installDevArchiveBinaries({
      archivePath: packaged.archivePath,
      binaryDirectory: installed,
      target: "aarch64-apple-darwin",
      expectedVersion: "8.1.3",
    });
    const ffmpeg = await readFile(join(installed, "ffmpeg-aarch64-apple-darwin"), "utf8");
    assert.match(ffmpeg, /8\.1\.3/);

    await writeTool(binaryDirectory, "ffprobe", "8.1.2");
    const mismatched = await packageDevArchive({
      binaryDirectory,
      target: "aarch64-apple-darwin",
      sourceAssetDirectory: sourceDirectory,
      noticesPath: join(directory, "NOTICE.md"),
      recipeFiles: {
        "build-release.mjs": join(directory, "build-release.mjs"),
        "sources.json": join(directory, "sources.json"),
        "recipe.mjs": join(directory, "recipe.mjs"),
      },
      outputDirectory: join(directory, "mismatch"),
      pin,
    });
    await assert.rejects(
      () => installDevArchiveBinaries({
        archivePath: mismatched.archivePath,
        binaryDirectory: join(directory, "rejected"),
        target: "aarch64-apple-darwin",
        expectedVersion: "8.1.3",
      }),
      /does not match the pinned 8\.1\.3 engine/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses to package binaries without corresponding sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vidra-dev-archive-empty-"));
  try {
    const binaryDirectory = join(directory, "binaries");
    await writeTool(binaryDirectory, "ffmpeg", "8.1.3");
    await writeTool(binaryDirectory, "ffprobe", "8.1.3");
    const sourceDirectory = join(directory, "sources");
    const { mkdir, writeFile: write } = await import("node:fs/promises");
    await mkdir(sourceDirectory, { recursive: true });
    await write(join(sourceDirectory, "SHA256SUMS"), "\n");
    await write(join(sourceDirectory, "BUILD_CONFIGURATION.txt"), "recipe\n");
    const pin = await readDevArchivePin();
    await assert.rejects(
      () => packageDevArchive({
        binaryDirectory,
        target: "aarch64-apple-darwin",
        sourceAssetDirectory: sourceDirectory,
        noticesPath: join(directory, "missing"),
        recipeFiles: {},
        outputDirectory: join(directory, "out"),
        pin,
      }),
      /Corresponding source archives are missing/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checks the placeholder before downloading and does not compile on that path", () => {
  const source = readFileSync(new URL("./prepare.mjs", import.meta.url), "utf8");
  const buildImport = source.indexOf('await import("./build-release.mjs")');
  const pinCheck = source.indexOf("assertDevArchivePinned(pin)");
  const download = source.indexOf("await downloadDevArchive(");
  assert.ok(buildImport > 0);
  assert.ok(pinCheck > buildImport);
  assert.ok(download > pinCheck);
  assert.match(source.slice(0, pinCheck), /if \(buildRequested\)/);
  assert.doesNotMatch(source.slice(pinCheck), /build-release/);
});

async function writeTool(directory, name, version) {
  const { mkdir, chmod } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${name}-aarch64-apple-darwin`);
  await writeFile(path, `#!/bin/sh\necho "${name} version ${version} Copyright"\n`);
  await chmod(path, 0o755);
}
