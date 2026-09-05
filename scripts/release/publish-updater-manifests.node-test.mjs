import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";

const publisher = resolve(import.meta.dirname, "publish-updater-manifests.mjs");
const manifest = (version) => ({ version, platforms: { "darwin-aarch64": { url: "https://example.com/Vidra.app.tar.gz", signature: "signed" } } });

// Exercise the real CLI entry point without contacting or changing GitHub.
const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.env.VIDRA_PUBLISH_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (args[0] === 'api') {
  if (args[1].endsWith('/updater-manifest')) {
    if (fixture.rollingError) { process.stderr.write('gh: failed (HTTP ' + fixture.rollingError + ')'); process.exit(1); }
    process.stdout.write(JSON.stringify({ draft: false, assets: Object.keys(fixture.assets).map(name => ({ name })) }));
  } else {
    process.stdout.write(JSON.stringify({ draft: !!fixture.draft, prerelease: fixture.prerelease, target_commitish: 'reviewed-commit' }));
  }
} else if (args[0] === 'release' && args[1] === 'download') {
  const name = option('--pattern');
  const data = args[2] === 'updater-manifest' ? fixture.assets[name] : fixture.incoming;
  fs.mkdirSync(option('--dir'), { recursive: true });
  fs.writeFileSync(path.join(option('--dir'), name), JSON.stringify(data));
} else if (args[0] === 'release' && ['upload', 'create'].includes(args[1])) {
  const files = args.slice(3, args.indexOf('--repo')).map(file => ({ name: path.basename(file), manifest: JSON.parse(fs.readFileSync(file, 'utf8')) }));
  fs.writeFileSync(process.env.VIDRA_PUBLISH_LOG, JSON.stringify({ operation: args[1], files }));
} else { throw new Error('Unexpected gh call: ' + JSON.stringify(args)); }
`;

function runPublisher(fixture) {
  const directory = mkdtempSync(join(tmpdir(), "vidra-publisher-test-"));
  try {
    writeFileSync(join(directory, "gh"), fakeGh, { mode: 0o755 });
    const fixturePath = join(directory, "fixture.json");
    const logPath = join(directory, "writes.json");
    writeFileSync(fixturePath, JSON.stringify(fixture));
    let error;
    try {
      execFileSync(process.execPath, [publisher], { encoding: "utf8", stdio: "pipe", env: {
        ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`,
        GITHUB_REPOSITORY: "test/vidra", RELEASE_TAG: `v${fixture.incoming.version}`,
        VIDRA_PUBLISH_FIXTURE: fixturePath, VIDRA_PUBLISH_LOG: logPath,
      } });
    } catch (cause) { error = cause; }
    let writes = null;
    try { writes = JSON.parse(readFileSync(logPath, "utf8")); } catch {}
    return { error, writes };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the publication CLI uploads only Beta for a new prerelease", () => {
  const result = runPublisher({ prerelease: true, incoming: manifest("0.2.0-beta.1"), assets: { "latest.json": manifest("0.1.0") } });
  assert.equal(result.error, undefined);
  assert.equal(result.writes.operation, "upload");
  assert.deepEqual(result.writes.files, [{ name: "beta.json", manifest: manifest("0.2.0-beta.1") }]);
});

test("the publication CLI creates both channel assets for the first official release", () => {
  const result = runPublisher({ prerelease: false, incoming: manifest("0.1.0"), rollingError: 404 });
  assert.equal(result.error, undefined);
  assert.equal(result.writes.operation, "create");
  assert.deepEqual(result.writes.files.map(file => file.name), ["latest.json", "beta.json"]);
  assert.ok(result.writes.files.every(file => file.manifest.version === "0.1.0"));
});

test("the publication CLI performs no writes for an older official release", () => {
  const result = runPublisher({ prerelease: false, incoming: manifest("0.1.0"), assets: { "latest.json": manifest("0.1.1"), "beta.json": manifest("0.2.0-beta.1") } });
  assert.equal(result.error, undefined);
  assert.equal(result.writes, null);
});

test("drafts and GitHub authorization failures never cause channel writes", () => {
  for (const fixture of [
    { draft: true },
    { rollingError: 403 },
  ]) {
    const result = runPublisher({ prerelease: false, incoming: manifest("0.1.0"), assets: {}, ...fixture });
    assert.ok(result.error);
    assert.equal(result.writes, null);
  }
});
