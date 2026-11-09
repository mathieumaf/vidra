import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  prepareUpdaterManifest,
  versionFromReleaseTag,
} from "./prepare-updater-manifest.mjs";
import { fixtureSignature, minisignKeyPair, trustedComment } from "./updater-signature-fixtures.mjs";

const buildManifest = (platforms = ["darwin-aarch64", "darwin-aarch64-app"]) => ({
  version: "0.2.0",
  platforms: Object.fromEntries(platforms.map((platform) => (
    [platform, { url: "https://example.com/Vidra.app.tar.gz", signature: fixtureSignature("0.2.0") }]
  ))),
});

test("announces the exact prerelease tag with a signature bound to it", () => {
  const signature = fixtureSignature("0.2.0-rc.3");
  const manifest = prepareUpdaterManifest(buildManifest(), "v0.2.0-rc.3", `${signature}\n`);

  assert.equal(manifest.version, "0.2.0-rc.3");
  for (const platform of Object.values(manifest.platforms)) {
    assert.equal(platform.signature, signature);
    assert.equal(platform.url, "https://example.com/Vidra.app.tar.gz");
  }
});

test("refuses to announce a prerelease with the bundle-version signature", () => {
  // Regression for v0.2.0-rc.2: signed for 0.2.0, announced as 0.2.0-rc.2.
  assert.throws(
    () => prepareUpdaterManifest(buildManifest(), "v0.2.0-rc.2", fixtureSignature("0.2.0")),
    /bound to version 0\.2\.0, but the manifest announces 0\.2\.0-rc\.2/,
  );
  assert.throws(() => prepareUpdaterManifest(buildManifest(), "v0.2.0-rc.2"), /signature bound to the release tag/);
});

test("rejects tags and manifests that the updater cannot use", () => {
  assert.throws(() => versionFromReleaseTag("v0.1-beta"), /semantic version/);
  assert.throws(() => versionFromReleaseTag("ffmpeg-dev-8.1.3-r6"), /semantic version/);
  assert.throws(() => versionFromReleaseTag("v0.1.0-beta.03"), /semantic version/);
  assert.throws(() => prepareUpdaterManifest({ platforms: {} }, "v0.1.0", fixtureSignature("0.1.0")), /platform/);

  const mixed = buildManifest();
  mixed.platforms["darwin-aarch64-app"].url = "https://example.com/Other.app.tar.gz";
  assert.throws(() => prepareUpdaterManifest(mixed, "v0.2.0", fixtureSignature("0.2.0")), /same updater archive/);
});

test("the CLI refuses an archive that the committed updater key did not sign", () => {
  const directory = mkdtempSync(join(tmpdir(), "vidra-prepare-manifest-test-"));
  try {
    const archive = join(directory, "Vidra_0.2.0_aarch64.app.tar.gz");
    const manifestPath = join(directory, "latest.json");
    writeFileSync(archive, "updater archive");
    writeFileSync(`${archive}.sig`, minisignKeyPair().sign(Buffer.from("updater archive"), trustedComment("0.2.0-rc.3")));
    writeFileSync(manifestPath, JSON.stringify(buildManifest()));
    const script = resolve(import.meta.dirname, "prepare-updater-manifest.mjs");
    assert.throws(
      () => execFileSync(process.execPath, [script, manifestPath, "v0.2.0-rc.3", archive], { stdio: "pipe" }),
      (error) => /different key/.test(error.stderr.toString()),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
