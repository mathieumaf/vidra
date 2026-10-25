import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  developmentEntry,
  hostTargetTriple,
  rejectReleaseDevelopmentOverride,
  releaseEntry,
} from "./target.mjs";

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

test("keeps the Apple Silicon development and release recipes under that target", () => {
  assert.deepEqual(Object.keys(manifest), ["targets"]);
  assert.deepEqual(Object.keys(manifest.targets), ["aarch64-apple-darwin"]);

  const development = developmentEntry(manifest, "aarch64-apple-darwin");
  assert.equal(development.developmentOnly, true);
  assert.equal(development.provider, "Vidra");
  assert.equal(development.sourceRelease, "v0.1.0");
  assert.equal(
    development.archive.url,
    "https://github.com/mathieumaf/vidra/releases/download/v0.1.0/Vidra_0.1.0_aarch64.app.tar.gz",
  );
  assert.equal(
    development.archive.sha256,
    "1c88316fef3870fc3f2a0edb44749411cc42fbe720874e0977dbf7d227d8a3de",
  );
  assert.equal(development.binaries.ffmpeg.archivePath, "Vidra.app/Contents/MacOS/ffmpeg");
  assert.equal(
    development.binaries.ffmpeg.binarySha256,
    "4d49639483af36460a07b66f418e70224f16cbc35eda2dcdae9385e1e1f0704c",
  );
  assert.equal(development.binaries.ffprobe.archivePath, "Vidra.app/Contents/MacOS/ffprobe");
  assert.equal(
    development.binaries.ffprobe.binarySha256,
    "bcae19b520bdb3ae568514078d1cc210b2ef8f0fd0180ce8d62609c67e1cc6c9",
  );

  const release = releaseEntry(manifest, "aarch64-apple-darwin");
  assert.equal(release.target, "aarch64-apple-darwin");
  assert.equal(release.minimumMacOSVersion, "12.0");
  assert.equal(release.sources.ffmpeg.version, "8.1.2");
  assert.equal(development.version, release.sources.ffmpeg.version);
  // Release recipe fingerprint. Change this hash only when the recipe change is intentional.
  assert.equal(
    createHash("sha256").update(JSON.stringify({ version: 6, release })).digest("hex"),
    "771a67c6fd618817e9a68f2a80982ecea6d052b8557e13cd38000342c24698b4",
  );
});

test("reports an unsupported target when no pinned sidecar exists", () => {
  for (const target of ["x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"]) {
    assert.throws(() => developmentEntry(manifest, target), /Unsupported target/);
    assert.throws(() => releaseEntry(manifest, target), /Unsupported target/);
  }
  assert.throws(
    () => releaseEntry(
      { targets: { "aarch64-apple-darwin": { release: { target: "other" } } } },
      "aarch64-apple-darwin",
    ),
    /Unsupported target aarch64-apple-darwin/,
  );
});

test("refuses to mix a release build with the local FFmpeg override", () => {
  assert.throws(
    () => rejectReleaseDevelopmentOverride("release", "/usr/bin"),
    /VIDRA_FFMPEG_DIR cannot be used for a release FFmpeg build/,
  );
  assert.doesNotThrow(() => rejectReleaseDevelopmentOverride("release", ""));
  assert.doesNotThrow(() => rejectReleaseDevelopmentOverride(undefined, "/usr/bin"));
});
