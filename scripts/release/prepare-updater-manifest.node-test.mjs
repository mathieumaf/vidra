import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareUpdaterManifest,
  versionFromReleaseTag,
} from "./prepare-updater-manifest.mjs";

test("uses the exact prerelease tag as the updater version", () => {
  const manifest = prepareUpdaterManifest({
    version: "0.1.0",
    platforms: {
      "darwin-aarch64": { url: "https://example.com/Vidra.app.tar.gz", signature: "signed" },
    },
  }, "v0.1.0-beta.4");

  assert.equal(manifest.version, "0.1.0-beta.4");
});

test("rejects tags and manifests that the updater cannot use", () => {
  assert.throws(() => versionFromReleaseTag("v0.1-beta"), /semantic version/);
  assert.throws(() => versionFromReleaseTag("v0.1.0-beta.03"), /semantic version/);
  assert.throws(() => prepareUpdaterManifest({ platforms: {} }, "v0.1.0"), /platform/);
});
