import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertArchiveComplete,
  assertEngineMatchesRecipe,
  assertEnginePinned,
  ENGINE_ARCHIVE_ROOT,
  ENGINE_SHA256_PLACEHOLDER,
  engineArchiveRoot,
  exportCorrespondingSources,
  installEngineBinaries,
  listArchive,
  readEnginePin,
  requiredEngineMembers,
} from "./engine.mjs";
import { packageEngine, RECIPE_FILES } from "./package-engine.mjs";
import { BUILD_RECIPE_VERSION, recipeFingerprint } from "./recipe.mjs";
import { recipeEntry } from "./target.mjs";

const manifest = JSON.parse(await readFile(new URL("./sources.json", import.meta.url), "utf8"));
const recipe = recipeEntry(manifest, "aarch64-apple-darwin");

test("pins one published engine archive built from the current recipe", async () => {
  const pin = await readEnginePin();
  assert.equal(pin.version, recipe.sources.ffmpeg.version);
  assert.equal(pin.version, "8.1.3");
  assert.equal(pin.recipeVersion, BUILD_RECIPE_VERSION);
  assert.equal(pin.target, "aarch64-apple-darwin");
  // The application release workflow runs on vX.Y.Z tags only.
  assert.doesNotMatch(pin.tag, /^v/);
  assert.match(pin.archiveName, new RegExp(`${pin.version}-${pin.target}-recipe${pin.recipeVersion}\\.tar\\.xz$`));
  assert.equal(
    pin.url,
    `https://github.com/mathieumaf/vidra/releases/download/${pin.tag}/${pin.archiveName}`,
  );
  assert.equal(pin.recipeFingerprint, recipeFingerprint(recipe));
  assert.equal(pin.sha256, "d89964bedaa6bfd660cb2c39adbda7e04ff00580e10922da9b54b3bb1cfe82c8");
  assert.doesNotThrow(() => assertEnginePinned(pin));
  assert.doesNotThrow(() => assertEngineMatchesRecipe(pin, recipe));
});

test("reads an older archive's root folder from the pin and defaults new ones", () => {
  assert.equal(engineArchiveRoot({ archiveRoot: "vidra-ffmpeg-dev" }), "vidra-ffmpeg-dev");
  assert.equal(engineArchiveRoot({}), ENGINE_ARCHIVE_ROOT);
  assert.ok(requiredEngineMembers("vidra-ffmpeg-dev").includes("vidra-ffmpeg-dev/ffprobe"));
});

test("rejects a placeholder or malformed archive checksum", () => {
  const pin = { version: "8.1.3", sha256: ENGINE_SHA256_PLACEHOLDER };
  assert.throws(() => assertEnginePinned(pin), /still "placeholder"/);
  assert.throws(() => assertEnginePinned(pin), /pnpm ffmpeg:prepare -- --build/);
  assert.throws(
    () => assertEnginePinned({ version: "8.1.3", sha256: "not-a-checksum" }),
    /64-character SHA-256/,
  );
});

test("rejects an archive built from another recipe or another FFmpeg version", () => {
  assert.throws(
    () => assertEngineMatchesRecipe({ version: "8.1.3", recipeFingerprint: "stale" }, recipe),
    /was built from another recipe/,
  );
  assert.throws(
    () => assertEngineMatchesRecipe({ version: "8.1.2", recipeFingerprint: recipeFingerprint(recipe) }, recipe),
    /does not match the recipe's FFmpeg 8\.1\.3/,
  );
});

test("installs a packaged archive only when both tools report the pinned version", async () => {
  const fixture = await engineFixture();
  try {
    const packaged = await fixture.package();
    const entries = listArchive(packaged.archivePath);
    assertArchiveComplete(entries);
    for (const name of RECIPE_FILES) {
      assert.ok(entries.includes(`${ENGINE_ARCHIVE_ROOT}/build-recipe/${name}`), name);
    }
    assert.equal(
      (await readFile(packaged.sha256Path, "utf8")).trim(),
      `${packaged.sha256}  ${fixture.pin.archiveName}`,
    );

    const installed = join(fixture.directory, "installed");
    await installEngineBinaries({
      archivePath: packaged.archivePath,
      binaryDirectory: installed,
      target: "aarch64-apple-darwin",
      expectedVersion: "8.1.3",
    });
    assert.match(await readFile(join(installed, "ffmpeg-aarch64-apple-darwin"), "utf8"), /8\.1\.3/);
    assert.deepEqual((await readdir(installed)).sort(), ["ffmpeg-aarch64-apple-darwin", "ffprobe-aarch64-apple-darwin"]);

    await writeTool(fixture.binaryDirectory, "ffprobe", "8.1.2");
    const mismatched = await fixture.package(join(fixture.directory, "mismatch"));
    const rejected = join(fixture.directory, "rejected");
    await assert.rejects(
      () => installEngineBinaries({
        archivePath: mismatched.archivePath,
        binaryDirectory: rejected,
        target: "aarch64-apple-darwin",
        expectedVersion: "8.1.3",
      }),
      /ffprobe reported 8\.1\.2, which does not match the pinned 8\.1\.3 engine/,
    );
    assert.deepEqual(await readdir(rejected), []);
  } finally {
    await fixture.remove();
  }
});

test("exports corresponding sources only when they are the ones the recipe pins", async () => {
  const fixture = await engineFixture();
  try {
    const packaged = await fixture.package();
    const exported = join(fixture.directory, "exported");
    const files = await exportCorrespondingSources({
      archivePath: packaged.archivePath,
      recipe: fixture.recipe,
      outputDirectory: exported,
    });
    assert.deepEqual(files, ["BUILD_CONFIGURATION.txt", "SHA256SUMS", "ffmpeg-8.1.3.tar.xz"]);
    assert.equal(await readFile(join(exported, "ffmpeg-8.1.3.tar.xz"), "utf8"), "source\n");

    const tampered = structuredClone(fixture.recipe);
    tampered.sources.ffmpeg.sha256 = "0".repeat(64);
    await assert.rejects(
      () => exportCorrespondingSources({
        archivePath: packaged.archivePath,
        recipe: tampered,
        outputDirectory: join(fixture.directory, "tampered"),
      }),
      /Checksum mismatch for ffmpeg-8\.1\.3\.tar\.xz/,
    );

    const extended = structuredClone(fixture.recipe);
    extended.sources.x264 = { archiveName: "x264.tar.gz", sha256: "1".repeat(64) };
    await assert.rejects(
      () => exportCorrespondingSources({
        archivePath: packaged.archivePath,
        recipe: extended,
        outputDirectory: join(fixture.directory, "extended"),
      }),
      /Missing: x264\.tar\.gz/,
    );

    const reduced = { sources: {} };
    await assert.rejects(
      () => exportCorrespondingSources({
        archivePath: packaged.archivePath,
        recipe: reduced,
        outputDirectory: join(fixture.directory, "reduced"),
      }),
      /Unexpected: ffmpeg-8\.1\.3\.tar\.xz/,
    );
  } finally {
    await fixture.remove();
  }
});

test("refuses to package binaries without corresponding sources", async () => {
  const fixture = await engineFixture();
  try {
    await rm(join(fixture.sourceDirectory, "ffmpeg-8.1.3.tar.xz"));
    await assert.rejects(() => fixture.package(), /Corresponding source archives are missing/);
  } finally {
    await fixture.remove();
  }
});

test("refuses an archive without its sources, its checksums, or its build script", () => {
  const complete = [
    ...requiredEngineMembers(),
    `${ENGINE_ARCHIVE_ROOT}/corresponding-sources/ffmpeg-8.1.3.tar.xz`,
    `${ENGINE_ARCHIVE_ROOT}/build-recipe/build.mjs`,
  ];
  assert.doesNotThrow(() => assertArchiveComplete(complete));
  assert.throws(
    () => assertArchiveComplete(complete.filter((entry) => !entry.endsWith("SHA256SUMS"))),
    /missing GPL corresponding-source files/,
  );
  assert.throws(
    () => assertArchiveComplete(complete.filter((entry) => !entry.endsWith(".tar.xz"))),
    /does not contain the corresponding source archives/,
  );
  assert.throws(
    () => assertArchiveComplete(complete.filter((entry) => !entry.endsWith("build.mjs"))),
    /does not contain the script that compiled it/,
  );
});

test("installs the pinned archive first and compiles only when a build is requested", () => {
  const source = readFileSync(new URL("./prepare.mjs", import.meta.url), "utf8");
  const buildStatement = 'await import("./build.mjs")';
  const buildImport = source.indexOf(buildStatement);
  const pinCheck = source.indexOf("assertEnginePinned(pin)");
  const download = source.indexOf("await downloadEngine(");
  assert.ok(buildImport > 0);
  assert.ok(pinCheck > buildImport);
  assert.ok(download > pinCheck);
  assert.match(source.slice(0, buildImport), /if \(options\.build\) \{\s*$/);
  assert.doesNotMatch(source.slice(buildImport + buildStatement.length), /build\.mjs/);
});

async function engineFixture() {
  const directory = await mkdtemp(join(tmpdir(), "vidra-engine-"));
  const binaryDirectory = join(directory, "binaries");
  const sourceDirectory = join(directory, "sources");
  const recipeDirectory = join(directory, "recipe");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(recipeDirectory, { recursive: true });
  await writeTool(binaryDirectory, "ffmpeg", "8.1.3");
  await writeTool(binaryDirectory, "ffprobe", "8.1.3");
  await writeFile(join(directory, "NOTICE.md"), "notices\n");
  await writeFile(join(sourceDirectory, "SHA256SUMS"), "abc  ffmpeg-8.1.3.tar.xz\n");
  await writeFile(join(sourceDirectory, "BUILD_CONFIGURATION.txt"), "recipe\n");
  await writeFile(join(sourceDirectory, "ffmpeg-8.1.3.tar.xz"), "source\n");
  for (const name of RECIPE_FILES) {
    await writeFile(join(recipeDirectory, name), `${name}\n`);
  }
  const pin = { ...(await readEnginePin()), archiveRoot: undefined, sha256: "ignored-by-the-packager" };
  return {
    directory,
    binaryDirectory,
    sourceDirectory,
    pin,
    recipe: {
      sources: {
        ffmpeg: {
          archiveName: "ffmpeg-8.1.3.tar.xz",
          sha256: createHash("sha256").update("source\n").digest("hex"),
        },
      },
    },
    package: (outputDirectory = join(directory, "out")) => packageEngine({
      binaryDirectory,
      target: "aarch64-apple-darwin",
      sourceAssetDirectory: sourceDirectory,
      noticesPath: join(directory, "NOTICE.md"),
      recipeFiles: Object.fromEntries(RECIPE_FILES.map((name) => [name, join(recipeDirectory, name)])),
      outputDirectory,
      pin,
    }),
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

async function writeTool(directory, name, version) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${name}-aarch64-apple-darwin`);
  await writeFile(path, `#!/bin/sh\necho "${name} version ${version} Copyright"\n`);
  await chmod(path, 0o755);
}
