import assert from "node:assert/strict";
import test from "node:test";
import { channelPromotions, compareVersions } from "./update-channels.mjs";

function manifest(version) {
  return { version, platforms: { "darwin-aarch64": { url: `https://example.com/v${version}/Vidra.app.tar.gz`, signature: "signed" } } };
}
function promote(version, stable = null, beta = null) {
  return channelPromotions({ incoming: manifest(version), tag: `v${version}`, prerelease: version.split("+")[0].includes("-"), stable, beta });
}

test("orders versions by semantic precedence, including numeric identifiers and hyphens", () => {
  const versions = ["0.1.0-alpha", "0.1.0-alpha.1", "0.1.0-alpha.beta", "0.1.0-beta", "0.1.0-beta.2", "0.1.0-beta.10", "0.1.0-beta-build.1", "0.1.0-beta-build.2", "0.1.0-rc.1", "0.1.0", "0.1.1", "0.2.0-beta.1", "0.10.0", "1.0.0"];
  for (let index = 1; index < versions.length; index += 1) {
    assert.equal(compareVersions(versions[index - 1], versions[index]), -1);
    assert.equal(compareVersions(versions[index], versions[index - 1]), 1);
  }
  assert.equal(compareVersions("0.1.0+build.1", "0.1.0+build.2"), 0);
  assert.equal(compareVersions("0.1.0-beta.1+one", "0.1.0-beta.1+two"), 0);
  assert.equal(compareVersions("0.1.0-beta.1", "0.1.0-beta.a"), -1);
});

test("publishes the first official version to both channels from the legacy beta feed", () => {
  const result = promote("0.1.0", manifest("0.1.0-beta.5"));
  assert.equal(result.stable.version, "0.1.0");
  assert.equal(result.beta.version, "0.1.0");
});

test("publishes betas and release candidates only to Beta", () => {
  for (const version of ["0.2.0-beta.1", "0.2.0-rc.1"]) {
    const result = promote(version, manifest("0.1.0"), manifest("0.1.0"));
    assert.equal(result.stable, null);
    assert.equal(result.beta.version, version);
  }
  assert.equal(promote("0.1.0-beta.6", manifest("0.1.0-beta.5")).stable, null);
});

test("keeps Beta ahead when a stable hotfix is published", () => {
  const result = promote("0.1.1", manifest("0.1.0"), manifest("0.2.0-beta.1"));
  assert.equal(result.stable.version, "0.1.1");
  assert.equal(result.beta, null);
});

test("moves Beta to the official release that supersedes its release candidate", () => {
  const result = promote("0.2.0", manifest("0.1.1"), manifest("0.2.0-rc.1"));
  assert.equal(result.stable.version, "0.2.0");
  assert.equal(result.beta.version, "0.2.0");
});

test("never moves either channel backward or replaces an equal version", () => {
  for (const version of ["0.1.0", "0.2.0", "0.2.0+rebuilt", "0.2.0-beta.9"]) {
    assert.deepEqual(promote(version, manifest("0.2.0"), manifest("0.3.0-beta.1")), { stable: null, beta: null });
  }
});

test("repairs a missing or stale Beta feed from the newer official manifest", () => {
  for (const beta of [null, manifest("0.1.0-beta.5")]) {
    const result = promote("0.1.0-beta.4", manifest("0.1.0"), beta);
    assert.equal(result.stable, null);
    assert.equal(result.beta.version, "0.1.0");
  }
});

test("rejects inconsistent release metadata and malformed existing manifests", () => {
  assert.throws(() => channelPromotions({ incoming: manifest("0.1.0"), tag: "v0.1.1", prerelease: false }), /match/);
  assert.throws(() => channelPromotions({ incoming: manifest("0.2.0-beta.1"), tag: "v0.2.0-beta.1", prerelease: false }), /flag/);
  assert.throws(() => channelPromotions({ incoming: manifest("0.1.0"), tag: "v0.1.0", prerelease: true }), /flag/);
  assert.throws(() => promote("0.1.0", { version: "0.0.9", platforms: {} }), /platform/);
  assert.throws(() => promote("0.1.0", manifest("not-a-version")), /semantic version/);
});
