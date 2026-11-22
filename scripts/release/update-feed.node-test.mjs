import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import {
  assertPublishedOfficialRelease,
  assertReleaseComplete,
  COMPLETION_MARKER,
  completionMarker,
  feedUpdate,
  updaterArchiveUrls,
  validateManifest,
  validateReleaseManifest,
} from "./update-feed.mjs";
import { fixtureSignature, minisignKeyPair, trustedComment } from "./updater-signature-fixtures.mjs";

const ARCHIVE_NAME = "Vidra_0.2.0_aarch64.app.tar.gz";
const ARCHIVE_URL = "https://api.github.com/repos/test/vidra/releases/assets/42";
const assets = [
  { name: ARCHIVE_NAME, url: ARCHIVE_URL, browser_download_url: `https://github.com/test/vidra/releases/download/v0.2.0/${ARCHIVE_NAME}` },
  { name: `${ARCHIVE_NAME}.sig`, url: "https://api.github.com/repos/test/vidra/releases/assets/45" },
  { name: "Vidra_0.2.0_aarch64.dmg", url: "https://api.github.com/repos/test/vidra/releases/assets/43" },
  { name: "Vidra_0.2.0_aarch64.dmg.sha256", url: "https://api.github.com/repos/test/vidra/releases/assets/46" },
  { name: "SHA256SUMS", url: "https://api.github.com/repos/test/vidra/releases/assets/47" },
  { name: "BUILD_CONFIGURATION.txt", url: "https://api.github.com/repos/test/vidra/releases/assets/48" },
  { name: "ffmpeg-8.1.3.tar.xz", url: "https://api.github.com/repos/test/vidra/releases/assets/49" },
  { name: "latest.json", url: "https://api.github.com/repos/test/vidra/releases/assets/44" },
  { name: COMPLETION_MARKER, url: "https://api.github.com/repos/test/vidra/releases/assets/50" },
];
const sourceArchives = ["ffmpeg-8.1.3.tar.xz"];
const marker = completionMarker({ tag: "v0.2.0", commit: "abc123", assets, sourceArchives });
const manifest = (version, { signedVersion = version, url = ARCHIVE_URL, signature = fixtureSignature(signedVersion) } = {}) => ({
  version,
  platforms: {
    "darwin-aarch64": { url, signature },
    "darwin-aarch64-app": { url, signature },
  },
});

test("accepts the manifest of the release it belongs to", () => {
  const incoming = manifest("0.2.0");
  assert.equal(validateReleaseManifest({ manifest: incoming, tag: "v0.2.0", assets }), incoming);
  // `gh release view --json assets` names the same addresses differently.
  const viewed = [{ name: ARCHIVE_NAME, apiUrl: ARCHIVE_URL, url: assets[0].browser_download_url }];
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

test("refuses a manifest that no copy on Apple Silicon could select", () => {
  const intelOnly = { version: "0.2.0", platforms: { "darwin-x86_64": { url: ARCHIVE_URL, signature: fixtureSignature("0.2.0") } } };
  assert.throws(
    () => validateReleaseManifest({ manifest: intelOnly, tag: "v0.2.0", assets }),
    /has no darwin-aarch64 entry/,
  );
});

test("refuses a manifest the updater cannot read", () => {
  assert.throws(() => validateManifest(null), /must be a JSON object/);
  assert.throws(() => validateManifest([]), /must be a JSON object/);
  assert.throws(() => validateManifest({ platforms: {} }), /must contain a version/);
  assert.throws(() => validateManifest({ version: "0.2", platforms: {} }), /not a valid semantic version/);
  assert.throws(() => validateManifest({ version: "0.2.0" }), /must contain a platforms object/);
  assert.throws(
    () => validateManifest({ version: "0.2.0", platforms: [{ url: ARCHIVE_URL, signature: "x" }] }),
    /must contain a platforms object/,
  );
  assert.throws(() => validateManifest({ version: "0.2.0", platforms: {} }), /download URL and a signature/);
  assert.throws(
    () => validateManifest({ version: "0.2.0", platforms: { "darwin-aarch64": { url: ARCHIVE_URL } } }),
    /download URL and a signature/,
  );
  assert.throws(
    () => validateManifest(manifest("0.2.0", { url: "http://github.com/test/vidra/releases/download/v0.2.0/a.app.tar.gz" })),
    /must use HTTPS/,
  );
  // A feed asset left by a release candidate is still readable.
  assert.doesNotThrow(() => validateManifest(manifest("0.2.0-rc.3")));
});

test("moves each feed asset forward, and never backward", () => {
  const incoming = manifest("0.2.0");
  const moved = (current) => feedUpdate(incoming, current);
  assert.deepEqual(moved({ "latest.json": null, "beta.json": null }), ["latest.json", "beta.json"]);
  assert.deepEqual(moved({ "latest.json": manifest("0.1.0"), "beta.json": manifest("0.2.0-rc.3") }), ["latest.json", "beta.json"]);
  assert.deepEqual(moved({ "latest.json": manifest("0.2.0"), "beta.json": manifest("0.2.0-rc.3") }), ["beta.json"]);
  assert.deepEqual(moved({ "latest.json": manifest("0.2.0"), "beta.json": manifest("0.2.0") }), []);
  assert.deepEqual(moved({ "latest.json": manifest("0.2.1"), "beta.json": manifest("0.2.1") }), []);
  // A missing asset is filled when the other one is not ahead of this release.
  assert.deepEqual(moved({ "latest.json": null, "beta.json": manifest("0.1.0") }), ["latest.json", "beta.json"]);
  assert.deepEqual(moved({ "latest.json": null, "beta.json": manifest("0.2.0") }), ["latest.json"]);
});

test("never fills a missing feed asset with a release older than what the feed already offers", () => {
  // The surviving manifest was not verified by this run, so it is not copied either.
  assert.throws(
    () => feedUpdate(manifest("0.2.0"), { "latest.json": null, "beta.json": { version: "0.2.1" } }),
    /latest\.json is missing from the update feed, and beta\.json already offers 0\.2\.1, which is newer than 0\.2\.0/,
  );
});

test("stops on a published feed asset that is not a manifest", () => {
  const incoming = manifest("0.2.0");
  assert.throws(() => feedUpdate(incoming, { "latest.json": {}, "beta.json": null }), /published latest\.json is not a manifest.*Repair/);
  assert.throws(() => feedUpdate(incoming, { "latest.json": { version: "soon" }, "beta.json": null }), /not a valid semantic version/);
});

test("offers only a published, official, complete release", () => {
  assert.doesNotThrow(() => assertPublishedOfficialRelease({ draft: false, prerelease: false }, "v0.2.0"));
  assert.throws(() => assertPublishedOfficialRelease({ draft: true, prerelease: false }, "v0.2.0"), /is a draft/);
  assert.throws(() => assertPublishedOfficialRelease({ draft: false, prerelease: true }, "v0.2.0"), /marked as a prerelease/);
  assert.throws(() => assertPublishedOfficialRelease(null, "v0.2.0"), /is a draft/);

  assert.doesNotThrow(() => assertReleaseComplete(assets, "v0.2.0", marker));
  const without = (name) => assets.filter((asset) => asset.name !== name);
  // No marker, or the marker of another tag: the release workflow did not finish.
  assert.throws(() => assertReleaseComplete(assets, "v0.2.0", null), /has no release-complete\.json for this tag/);
  assert.throws(() => assertReleaseComplete(assets, "v0.2.0", { ...marker, tag: "v0.1.0" }), /has no release-complete\.json for this tag/);
  // Something the marker lists is gone, such as a source archive whose upload was interrupted.
  assert.throws(() => assertReleaseComplete(without("ffmpeg-8.1.3.tar.xz"), "v0.2.0", marker), /Missing: ffmpeg-8\.1\.3\.tar\.xz\./);
  assert.throws(() => assertReleaseComplete(without("Vidra_0.2.0_aarch64.dmg.sha256"), "v0.2.0", marker), /the disk image's checksum/);
});

test("marks a release complete only with every kind of asset and every pinned source", () => {
  assert.deepEqual(marker, { tag: "v0.2.0", commit: "abc123", assets: assets.map((asset) => asset.name).sort() });
  const make = (attached, sources = sourceArchives) => completionMarker({ tag: "v0.2.0", commit: "abc123", assets: attached, sourceArchives: sources });
  const without = (name) => assets.filter((asset) => asset.name !== name);
  assert.throws(() => make(without("SHA256SUMS")), /Missing: the FFmpeg source checksums \(SHA256SUMS\)\./);
  assert.throws(() => make(without(`${ARCHIVE_NAME}.sig`)), /the updater archive's signature/);
  assert.throws(() => make(without("latest.json")), /the update manifest/);
  // SHA256SUMS is there, but one of the sources it lists never arrived.
  assert.throws(() => make(assets, [...sourceArchives, "x265-4.2.tar.gz"]), /Missing: x265-4\.2\.tar\.gz\./);
  assert.throws(() => completionMarker({ tag: "v0.2.0-rc.1", commit: "abc123", assets, sourceArchives }), /is not a release tag/);
});

// Exercise the real CLI entry point without contacting or changing GitHub.
const publisher = resolve(import.meta.dirname, "publish-update-feed.mjs");
const keys = minisignKeyPair();
const archive = Buffer.from("updater archive of the published release");
const signed = (version, data = archive, signer = keys) => manifest(version, { signature: signer.sign(data, trustedComment(version)) });
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
  fs.mkdirSync(option('--dir'), { recursive: true });
  const destination = path.join(option('--dir'), name);
  if (name.endsWith('.app.tar.gz')) fs.writeFileSync(destination, Buffer.from(fixture.archive, 'base64'));
  else if (name === 'release-complete.json') fs.writeFileSync(destination, JSON.stringify(fixture.marker));
  else fs.writeFileSync(destination, JSON.stringify(args[2] === 'updater-manifest' ? fixture.feed[name] : fixture.incoming));
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
    const configPath = join(directory, "tauri.conf.json");
    writeFileSync(configPath, JSON.stringify({ plugins: { updater: { pubkey: keys.publicKey } } }));
    writeFileSync(fixturePath, JSON.stringify({ assets, marker, feed: {}, archive: archive.toString("base64"), ...fixture }));
    let error;
    let output = "";
    try {
      output = execFileSync(process.execPath, [publisher, configPath], { encoding: "utf8", stdio: "pipe", env: {
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
  const result = publish({ incoming: signed("0.2.0"), feed: { "latest.json": manifest("0.1.0"), "beta.json": manifest("0.2.0-rc.3") } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, {
    operation: "upload",
    target: "updater-manifest",
    files: [{ name: "latest.json", version: "0.2.0" }, { name: "beta.json", version: "0.2.0" }],
  });
});

test("publishing creates the feed when it does not exist yet", () => {
  const result = publish({ incoming: signed("0.2.0"), feedError: 404 });
  assert.equal(result.error, undefined);
  assert.equal(result.writes.operation, "create");
  assert.deepEqual(result.writes.files.map((file) => file.name), ["latest.json", "beta.json"]);
});

test("publishing an older release writes nothing", () => {
  const result = publish({ incoming: signed("0.2.0"), feed: { "latest.json": manifest("0.2.1"), "beta.json": manifest("0.2.1") } });
  assert.equal(result.error, undefined);
  assert.equal(result.writes, null);
  assert.match(result.output, /already offers an equal or newer release/);
});

test("publishing an older release never fills a gap in the feed", () => {
  // An unverified leftover in the other asset is neither copied nor overtaken.
  const result = publish({ incoming: signed("0.2.0"), feed: { "beta.json": { version: "0.2.1" } } });
  assert.ok(result.error);
  assert.match(result.error.stderr, /latest\.json is missing from the update feed, and beta\.json already offers 0\.2\.1/);
  assert.equal(result.writes, null);
});

test("publishing moves only the feed asset that is behind", () => {
  const result = publish({ incoming: signed("0.2.0"), feed: { "latest.json": manifest("0.2.0"), "beta.json": manifest("0.2.0-rc.3") } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes.files, [{ name: "beta.json", version: "0.2.0" }]);
});

test("a signature that does not verify the published archive writes nothing", () => {
  for (const [incoming, message] of [
    // The version text is right, but the signature was made over other bytes.
    [signed("0.2.0", Buffer.from("another archive")), /does not match the updater archive/],
    // Signed by a key the app does not ship.
    [signed("0.2.0", archive, minisignKeyPair()), /different key than the committed public key/],
    // Well formed, with the right version, and not a signature at all.
    [manifest("0.2.0"), /different key|does not match/],
  ]) {
    const result = publish({ incoming, feed: { "latest.json": manifest("0.1.0") } });
    assert.ok(result.error);
    assert.match(result.error.stderr, message);
    assert.equal(result.writes, null);
  }
});

test("a draft, a prerelease, an unfinished release, a failed lookup, or a bad manifest writes nothing", () => {
  for (const [fixture, message] of [
    [{ draft: true }, /is a draft/],
    [{ prerelease: true }, /marked as a prerelease/],
    [{ assets: assets.filter((asset) => asset.name !== "ffmpeg-8.1.3.tar.xz") }, /is incomplete\. Missing: ffmpeg-8\.1\.3\.tar\.xz/],
    [{ assets: assets.filter((asset) => asset.name !== COMPLETION_MARKER) }, /has no release-complete\.json for this tag/],
    [{ marker: { ...marker, tag: "v0.1.9" } }, /has no release-complete\.json for this tag/],
    [{ feedError: 403 }, /HTTP 403/],
    [{ incoming: manifest("0.2.0", { signedVersion: "0.1.0" }) }, /bound to version 0\.1\.0/],
    [{ incoming: manifest("0.2.0", { url: "https://example.com/a.app.tar.gz" }) }, /does not download an updater archive/],
    [{ feed: { "latest.json": { broken: true } } }, /Repair the update feed by hand/],
  ]) {
    const result = publish({ incoming: signed("0.2.0"), feed: { "latest.json": manifest("0.1.0") }, ...fixture });
    assert.ok(result.error, JSON.stringify(Object.keys(fixture)));
    assert.match(result.error.stderr, message);
    assert.equal(result.writes, null);
  }
});

test("a tag that is not a release tag writes nothing", () => {
  for (const tag of ["v0.2.0-rc.4", "ffmpeg-engine-8.1.3-r6", "updater-manifest"]) {
    const result = publish({ incoming: signed("0.2.0") }, tag);
    assert.ok(result.error, tag);
    assert.match(result.error.stderr, /is not a release tag/);
    assert.equal(result.writes, null);
  }
});

test("the marker command reads the recipe's sources and refuses a draft that lacks one", () => {
  const directory = mkdtempSync(join(tmpdir(), "vidra-mark-complete-"));
  try {
    const recipe = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "ffmpeg", "sources.json"), "utf8"));
    const sources = Object.values(recipe.targets["aarch64-apple-darwin"].sources).map((source) => source.archiveName);
    const attached = [
      ARCHIVE_NAME, `${ARCHIVE_NAME}.sig`, "latest.json", "Vidra_0.2.0_aarch64.dmg", "Vidra_0.2.0_aarch64.dmg.sha256",
      "SHA256SUMS", "BUILD_CONFIGURATION.txt", ...sources,
    ].map((name) => ({ name }));
    const run = (assetList) => {
      writeFileSync(join(directory, "release.json"), JSON.stringify({ assets: assetList }));
      return execFileSync(process.execPath, [
        resolve(import.meta.dirname, "mark-complete.mjs"),
        join(directory, "release.json"), "v0.2.0", "abc123", join(directory, COMPLETION_MARKER),
      ], { encoding: "utf8", stdio: "pipe" });
    };
    assert.match(run(attached), /Release v0\.2\.0 is complete: 14 assets\./);
    const written = JSON.parse(readFileSync(join(directory, COMPLETION_MARKER), "utf8"));
    assert.equal(written.tag, "v0.2.0");
    assert.equal(written.commit, "abc123");
    assert.equal(written.assets.length, 14);
    assert.doesNotThrow(() => assertReleaseComplete([...attached, { name: COMPLETION_MARKER }], "v0.2.0", written));

    assert.throws(() => run(attached.filter((asset) => asset.name !== sources[0])), new RegExp(`Missing: ${sources[0].replaceAll(".", "\\.")}`));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
