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
  assert.equal(development.builtFrom, "release-recipe");
  assert.equal(development.archive, undefined);
  assert.equal(development.binaries, undefined);

  const release = releaseEntry(manifest, "aarch64-apple-darwin");
  assert.equal(release.target, "aarch64-apple-darwin");
  assert.equal(release.minimumMacOSVersion, "12.0");
  assert.equal(release.sources.ffmpeg.version, "8.1.3");
  assert.equal(release.sources.ffmpeg.archiveName, "ffmpeg-8.1.3.tar.xz");
  assert.equal(release.sources.ffmpeg.url, "https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz");
  assert.equal(
    release.sources.ffmpeg.sha256,
    "7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3",
  );
  assert.equal(development.version, release.sources.ffmpeg.version);
  // Release recipe fingerprint. The FFmpeg 8.1.3 source pin changed this hash on purpose.
  assert.equal(
    createHash("sha256").update(JSON.stringify({ version: 6, release })).digest("hex"),
    "27e95ad072130a0e0869b5372b5030a104cdd3bcbddd586468c2b40a845d079b",
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
