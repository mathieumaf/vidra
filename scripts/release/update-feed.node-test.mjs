import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import {
  assertPublishedOfficialRelease,
  feedMovesTo,
  updaterArchiveUrls,
  validateManifest,
  validateReleaseManifest,
} from "./update-feed.mjs";
import { fixtureSignature } from "./updater-signature-fixtures.mjs";

const ARCHIVE_URL = "https://api.github.com/repos/test/vidra/releases/assets/42";
const assets = [
  { name: "Vidra_0.2.0_aarch64.app.tar.gz", url: ARCHIVE_URL, browser_download_url: "https://github.com/test/vidra/releases/download/v0.2.0/Vidra_0.2.0_aarch64.app.tar.gz" },
  { name: "Vidra_0.2.0_aarch64.dmg", url: "https://api.github.com/repos/test/vidra/releases/assets/43" },
  { name: "latest.json", url: "https://api.github.com/repos/test/vidra/releases/assets/44" },
];
const manifest = (version, { signedVersion = version, url = ARCHIVE_URL } = {}) => ({
  version,
  platforms: {
    "darwin-aarch64": { url, signature: fixtureSignature(signedVersion) },
    "darwin-aarch64-app": { url, signature: fixtureSignature(signedVersion) },
  },
});

test("accepts the manifest of the release it belongs to", () => {
  const incoming = manifest("0.2.0");
  assert.equal(validateReleaseManifest({ manifest: incoming, tag: "v0.2.0", assets }), incoming);
  // `gh release view --json assets` names the same addresses differently.
  const viewed = [{ name: "Vidra_0.2.0_aarch64.app.tar.gz", apiUrl: ARCHIVE_URL, url: "https://github.com/test/vidra/releases/download/v0.2.0/Vidra_0.2.0_aarch64.app.tar.gz" }];
  assert.equal(validateReleaseManifest({ manifest: incoming, tag: "v0.2.0", assets: viewed }), incoming);
});

test("refuses a manifest for another version, another signature, or another download", () => {
  const check = (candidate, tag = "v0.2.0") => validateReleaseManifest({ manifest: candidate, tag, assets });
  assert.throws(() => check(manifest("0.2.1")), /announces 0\.2\.1, but the release tag is v0\.2\.0/);
  assert.throws(() => check(manifest("0.2.0", { signedVersion: "0.1.0" })), /bound to version 0\.1\.0/);
  assert.throws(() => check(manifest("0.2.0", { signedVersion: null })), /does not record the version/);
  assert.throws(() => check(manifest("0.2.0"), "v0.2.0-rc.1"), /is not a release tag/);
  assert.throws(
    () => check(manifest("0.2.0", { url: "https://example.com/Vidra.app.tar.gz" })),
    /does not download an updater archive attached to release v0\.2\.0/,
  );
  // The disk image and the manifest itself are assets of the release, but not updater archives.
  assert.throws(
    () => check(manifest("0.2.0", { url: "https://api.github.com/repos/test/vidra/releases/assets/43" })),
    /does not download an updater archive/,
  );
  assert.deepEqual(updaterArchiveUrls(assets), [ARCHIVE_URL, assets[0].browser_download_url]);
});

test("refuses a manifest the updater cannot use", () => {
  assert.throws(() => validateManifest(null), /must be a JSON object/);
  assert.throws(() => validateManifest([]), /must be a JSON object/);
  assert.throws(() => validateManifest({ platforms: {} }), /must contain a version/);
  assert.throws(() => validateManifest({ version: "0.2", platforms: {} }), /not a valid semantic version/);
  assert.throws(() => validateManifest({ version: "0.2.0", platforms: {} }), /download URL and a signature/);
  assert.throws(
    () => validateManifest({ version: "0.2.0", platforms: { "darwin-aarch64": { url: ARCHIVE_URL } } }),
    /download URL and a signature/,
  );
  assert.throws(
    () => validateManifest(manifest("0.2.0", { url: "http://github.com/test/vidra/releases/download/v0.2.0/a.app.tar.gz" })),
    /must use HTTPS/,
  );
});

test("moves the feed forward only", () => {
  const incoming = manifest("0.2.0");
  assert.equal(feedMovesTo(incoming, null), true);
  assert.equal(feedMovesTo(incoming, manifest("0.1.0")), true);
  // A feed asset left by the last release candidate moves to the official release.
  assert.equal(feedMovesTo(incoming, manifest("0.2.0-rc.3")), true);
  assert.equal(feedMovesTo(incoming, manifest("0.2.0")), false);
  assert.equal(feedMovesTo(incoming, manifest("0.2.1")), false);
  assert.equal(feedMovesTo(manifest("0.1.1"), manifest("0.2.0")), false);
  assert.throws(() => feedMovesTo(incoming, {}), /Repair it by hand/);
  assert.throws(() => feedMovesTo(incoming, { version: "soon" }), /not a valid semantic version/);
});

test("offers only a published, official release", () => {
  assert.doesNotThrow(() => assertPublishedOfficialRelease({ draft: false, prerelease: false }, "v0.2.0"));
  assert.throws(() => assertPublishedOfficialRelease({ draft: true, prerelease: false }, "v0.2.0"), /is a draft/);
  assert.throws(() => assertPublishedOfficialRelease({ draft: false, prerelease: true }, "v0.2.0"), /marked as a prerelease/);
  assert.throws(() => assertPublishedOfficialRelease(null, "v0.2.0"), /is a draft/);
});

// Exercise the real CLI entry point without contacting or changing GitHub.
const publisher = resolve(import.meta.dirname, "publish-update-feed.mjs");
const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.env.VIDRA_PUBLISH_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (args[0] === 'api') {
  if (args[1].endsWith('/updater-manifest')) {
    if (fixture.feedError) { process.stderr.write('gh: failed (HTTP ' + fixture.feedError + ')'); process.exit(1); }
    process.stdout.write(JSON.stringify({ draft: false, assets: Object.keys(fixture.feed).map(name => ({ name })) }));
  } else {
    process.stdout.write(JSON.stringify({ draft: !!fixture.draft, prerelease: !!fixture.prerelease, target_commitish: 'reviewed-commit', assets: fixture.assets }));
  }
} else if (args[0] === 'release' && args[1] === 'download') {
  const name = option('--pattern');
  const data = args[2] === 'updater-manifest' ? fixture.feed[name] : fixture.incoming;
  fs.mkdirSync(option('--dir'), { recursive: true });
  fs.writeFileSync(path.join(option('--dir'), name), JSON.stringify(data));
} else if (args[0] === 'release' && ['upload', 'create'].includes(args[1])) {
  const files = args.slice(3, args.indexOf('--repo')).map(file => ({ name: path.basename(file), version: JSON.parse(fs.readFileSync(file, 'utf8')).version }));
  fs.writeFileSync(process.env.VIDRA_PUBLISH_LOG, JSON.stringify({ operation: args[1], target: args[2], files }));
} else { throw new Error('Unexpected gh call: ' + JSON.stringify(args)); }
`;

function publish(fixture, tag = `v${fixture.incoming.version}`) {
  const directory = mkdtempSync(join(tmpdir(), "vidra-update-feed-test-"));
  try {
    writeFileSync(join(directory, "gh"), fakeGh, { mode: 0o755 });
    const fixturePath = join(directory, "fixture.json");
    const logPath = join(directory, "writes.json");
    writeFileSync(fixturePath, JSON.stringify({ assets, feed: {}, ...fixture }));
    let error;
    let output = "";
    try {
      output = execFileSync(process.execPath, [publisher], { encoding: "utf8", stdio: "pipe", env: {
        ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`,
        GITHUB_REPOSITORY: "test/vidra", RELEASE_TAG: tag,
        VIDRA_PUBLISH_FIXTURE: fixturePath, VIDRA_PUBLISH_LOG: logPath,
      } });
    } catch (cause) { error = cause; }
    let writes = null;
    try { writes = JSON.parse(readFileSync(logPath, "utf8")); } catch {}
    return { error, output, writes };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("publishing an official release moves both feed assets to it", () => {
  const result = publish({ incoming: manifest("0.2.0"), feed: { "latest.json": manifest("0.1.0"), "beta.json": manifest("0.2.0-rc.3") } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, {
    operation: "upload",
    target: "updater-manifest",
    files: [{ name: "latest.json", version: "0.2.0" }, { name: "beta.json", version: "0.2.0" }],
  });
});

test("publishing creates the feed when it does not exist yet", () => {
  const result = publish({ incoming: manifest("0.2.0"), feedError: 404 });
  assert.equal(result.error, undefined);
  assert.equal(result.writes.operation, "create");
  assert.deepEqual(result.writes.files.map((file) => file.name), ["latest.json", "beta.json"]);
});

test("publishing an older release writes nothing", () => {
  const result = publish({ incoming: manifest("0.2.0"), feed: { "latest.json": manifest("0.2.1"), "beta.json": manifest("0.2.1") } });
  assert.equal(result.error, undefined);
  assert.equal(result.writes, null);
  assert.match(result.output, /already offers an equal or newer release/);
});

test("publishing moves only the feed asset that is behind", () => {
  const result = publish({ incoming: manifest("0.2.0"), feed: { "latest.json": manifest("0.2.0"), "beta.json": manifest("0.2.0-rc.3") } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes.files, [{ name: "beta.json", version: "0.2.0" }]);
});

test("a draft, a prerelease, a failed lookup, or a bad manifest writes nothing", () => {
  for (const [fixture, message] of [
    [{ draft: true }, /is a draft/],
    [{ prerelease: true }, /marked as a prerelease/],
    [{ feedError: 403 }, /HTTP 403/],
    [{ incoming: manifest("0.2.0", { signedVersion: "0.1.0" }) }, /bound to version 0\.1\.0/],
    [{ incoming: manifest("0.2.0", { url: "https://example.com/a.app.tar.gz" }) }, /does not download an updater archive/],
    [{ feed: { "latest.json": { broken: true } } }, /Repair it by hand/],
  ]) {
    const result = publish({ incoming: manifest("0.2.0"), feed: { "latest.json": manifest("0.1.0") }, ...fixture });
    assert.ok(result.error, JSON.stringify(fixture));
    assert.match(result.error.stderr, message);
    assert.equal(result.writes, null);
  }
});

test("a tag that is not a release tag writes nothing", () => {
  for (const tag of ["v0.2.0-rc.4", "ffmpeg-engine-8.1.3-r6", "updater-manifest"]) {
    const result = publish({ incoming: manifest("0.2.0") }, tag);
    assert.ok(result.error, tag);
    assert.match(result.error.stderr, /is not a release tag/);
    assert.equal(result.writes, null);
  }
});
