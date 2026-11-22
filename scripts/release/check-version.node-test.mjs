import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkRelease, readVersions } from "./check-version.mjs";
import { releaseNotes } from "./release-notes.mjs";

const versions = (version, overrides = {}) => ({
  "package.json": version,
  "src-tauri/tauri.conf.json": version,
  "src-tauri/Cargo.toml": version,
  "src-tauri/Cargo.lock": version,
  ...overrides,
});
const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- Not out yet.",
  "",
  "## 0.2.0 - 2026-12-01",
  "",
  "### Fixed",
  "",
  "- Keep the source file.",
  "",
  "## 0.1.0 - 2026-09-05",
  "",
  "First release.",
  "",
].join("\n");

test("accepts one official version in every file, with or without its tag", () => {
  assert.equal(checkRelease({ versions: versions("0.2.0"), changelog }), "0.2.0");
  assert.equal(checkRelease({ versions: versions("0.2.0"), tag: "v0.2.0", changelog }), "0.2.0");
});

test("names the files when their versions differ", () => {
  assert.throws(
    () => checkRelease({ versions: versions("0.2.0", { "src-tauri/Cargo.lock": "0.1.0" }), changelog }),
    /Release versions do not match:[\s\S]*package\.json: 0\.2\.0[\s\S]*src-tauri\/Cargo\.lock: 0\.1\.0/,
  );
});

test("refuses a prerelease version and any tag that is not exactly the version", () => {
  assert.throws(
    () => checkRelease({ versions: versions("0.2.0-rc.4"), changelog }),
    /not a plain X\.Y\.Z version/,
  );
  for (const tag of ["v0.2.0-rc.4", "v0.2.0-beta.1", "0.2.0", "v0.2"]) {
    assert.throws(() => checkRelease({ versions: versions("0.2.0"), tag, changelog }), /is not a release tag/, tag);
  }
  assert.throws(
    () => checkRelease({ versions: versions("0.2.0"), tag: "v0.2.1", changelog }),
    /Tag v0\.2\.1 does not match application version 0\.2\.0/,
  );
});

test("refuses to tag a release without dated notes", () => {
  const check = (text) => checkRelease({ versions: versions("0.3.0"), tag: "v0.3.0", changelog: text });
  assert.throws(() => check(changelog), /has no "## 0\.3\.0 - YYYY-MM-DD" section/);
  assert.throws(() => check(`${changelog}\n## 0.3.0\n\n- Notes.\n`), /needs its release date/);
  assert.throws(() => check(`${changelog}\n## 0.3.0 - soon\n\n- Notes.\n`), /needs its release date/);
  assert.throws(() => check(`## 0.3.0 - 2027-01-01\n\n## 0.2.0 - 2026-12-01\n\n- Notes.\n`), /section of CHANGELOG\.md is empty/);
  // An untagged check does not need notes yet.
  assert.equal(checkRelease({ versions: versions("0.3.0"), changelog }), "0.3.0");
});

test("extracts exactly one release's notes", () => {
  assert.equal(releaseNotes(changelog, "0.2.0"), "### Fixed\n\n- Keep the source file.");
  assert.equal(releaseNotes(changelog, "0.1.0"), "First release.");
  // 0.2.0 must not match 0.2.0-rc.3 or 10.2.0 headings.
  const similar = "## 0.2.0-rc.3 - 2026-11-09\n\nCandidate.\n\n## 10.2.0 - 2030-01-01\n\nFuture.\n";
  assert.throws(() => releaseNotes(similar, "0.2.0"), /has no "## 0\.2\.0 - YYYY-MM-DD" section/);
});

test("the repository's own version files agree on an official version", async () => {
  const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const files = await readVersions(rootDirectory);
  assert.deepEqual(Object.keys(files), [
    "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock",
  ]);
  assert.match(checkRelease({ versions: files }), /^\d+\.\d+\.\d+$/);
});
