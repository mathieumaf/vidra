import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recipeFingerprint } from "./recipe.mjs";
import { hostTargetTriple, recipeEntry } from "./target.mjs";

const manifest = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8"));

test("maps host platform names onto Rust target triples", () => {
  assert.equal(hostTargetTriple("darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(hostTargetTriple("darwin", "x64"), "x86_64-apple-darwin");
  assert.equal(hostTargetTriple("linux", "x64"), "x86_64-unknown-linux-gnu");
  assert.equal(hostTargetTriple("linux", "arm64"), "aarch64-unknown-linux-gnu");
  assert.equal(hostTargetTriple("win32", "x64"), "x86_64-pc-windows-msvc");
  assert.equal(hostTargetTriple("win32", "arm64"), "aarch64-pc-windows-msvc");
  assert.throws(() => hostTargetTriple("linux", "ppc64"), /Unsupported target linux\/ppc64/);
});

test("pins one engine recipe, for Apple Silicon", () => {
  assert.deepEqual(Object.keys(manifest), ["targets"]);
  assert.deepEqual(Object.keys(manifest.targets), ["aarch64-apple-darwin"]);

  const recipe = recipeEntry(manifest, "aarch64-apple-darwin");
  assert.equal(recipe.target, "aarch64-apple-darwin");
  assert.equal(recipe.minimumMacOSVersion, "12.0");
  assert.equal(recipe.sources.ffmpeg.version, "8.1.3");
  assert.equal(recipe.sources.ffmpeg.archiveName, "ffmpeg-8.1.3.tar.xz");
  assert.equal(recipe.sources.ffmpeg.url, "https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz");
  assert.equal(
    recipe.sources.ffmpeg.sha256,
    "7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3",
  );
  for (const source of Object.values(recipe.sources)) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/, source.archiveName);
    assert.match(source.url, /^https:\/\//, source.archiveName);
  }
  // A change to the sources or to BUILD_RECIPE_VERSION changes this value on
  // purpose. It then needs a new engine archive and a new pin in engine.json.
  assert.equal(
    recipeFingerprint(recipe),
    "27e95ad072130a0e0869b5372b5030a104cdd3bcbddd586468c2b40a845d079b",
  );
});

test("reports an unsupported target when no engine is pinned for it", () => {
  for (const target of ["x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"]) {
    assert.throws(() => recipeEntry(manifest, target), /Unsupported target/);
  }
  assert.throws(
    () => recipeEntry({ targets: { "aarch64-apple-darwin": { target: "other" } } }, "aarch64-apple-darwin"),
    /Unsupported target aarch64-apple-darwin/,
  );
});
