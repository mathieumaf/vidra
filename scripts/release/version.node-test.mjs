import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, isOfficialVersion, versionFromReleaseTag } from "./version.mjs";

test("accepts only vX.Y.Z as a release tag", () => {
  assert.equal(versionFromReleaseTag("v0.2.0"), "0.2.0");
  assert.equal(versionFromReleaseTag("v10.20.30"), "10.20.30");
  for (const tag of [
    "0.2.0", "v0.2", "v0.2.0.1", "v01.2.0", "v0.2.0-rc.1", "v0.2.0-beta.1", "v0.2.0+build.1",
    "ffmpeg-engine-8.1.3-r6", "updater-manifest", "", undefined, null,
  ]) {
    assert.throws(() => versionFromReleaseTag(tag), /is not a release tag/, String(tag));
  }
});

test("tells an official version from a prerelease or a build", () => {
  assert.equal(isOfficialVersion("1.0.0"), true);
  assert.equal(isOfficialVersion("1.0.0-rc.1"), false);
  assert.equal(isOfficialVersion("1.0.0+build.5"), false);
  assert.throws(() => isOfficialVersion("1.0"), /not a valid semantic version/);
  assert.throws(() => isOfficialVersion("1.0.0-rc.01"), /not a valid semantic version/);
});

test("orders versions by semantic precedence, including numeric identifiers and hyphens", () => {
  const ordered = [
    "0.1.0-beta.2", "0.1.0-beta.10", "0.1.0-rc.1", "0.1.0", "0.1.1", "0.2.0-alpha", "0.2.0-alpha.1",
    "0.2.0-alpha.beta", "0.2.0-beta", "0.2.0-beta-1", "0.2.0-rc.3", "0.2.0", "0.10.0", "1.0.0",
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareVersions(ordered[index - 1], ordered[index]), -1, `${ordered[index - 1]} < ${ordered[index]}`);
    assert.equal(compareVersions(ordered[index], ordered[index - 1]), 1);
  }
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3+build.1", "1.2.3+build.2"), 0);
});
