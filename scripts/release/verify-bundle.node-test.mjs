import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bundleProblems, expectedBundle } from "./verify-bundle.mjs";

const expected = {
  version: "0.2.0",
  identifier: "io.github.mathieumaf.vidra",
  minimumSystemVersion: "12.0",
  ffmpegVersion: "8.1.3",
  notices: "notices\n",
};
const plist = {
  CFBundleExecutable: "Vidra",
  CFBundleShortVersionString: "0.2.0",
  CFBundleIdentifier: "io.github.mathieumaf.vidra",
  LSMinimumSystemVersion: "12.0",
};

function fakeBundle({ sidecars = { ffmpeg: "8.1.3", ffprobe: "8.1.3" }, notices = "notices\n", executable = true } = {}) {
  const bundle = join(mkdtempSync(join(tmpdir(), "vidra-bundle-")), "Vidra.app");
  mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(bundle, "Contents", "Resources"), { recursive: true });
  const tool = (name, version) => {
    const path = join(bundle, "Contents", "MacOS", name);
    writeFileSync(path, `#!/bin/sh\necho "${name} version ${version} Copyright"\n`);
    chmodSync(path, 0o755);
  };
  if (executable) tool("Vidra", "0.2.0");
  for (const [name, version] of Object.entries(sidecars)) tool(name, version);
  if (notices !== null) writeFileSync(join(bundle, "Contents", "Resources", "THIRD_PARTY_NOTICES.md"), notices);
  return { bundle, remove: () => rmSync(dirname(bundle), { recursive: true, force: true }) };
}

test("accepts a bundle with the expected identity, the pinned engine, and the notices", () => {
  const { bundle, remove } = fakeBundle();
  try {
    assert.deepEqual(bundleProblems({ bundle, expected, plist }), []);
  } finally {
    remove();
  }
});

test("names every difference in one report", () => {
  const { bundle, remove } = fakeBundle({ sidecars: { ffmpeg: "8.1.2" }, notices: "old notices\n", executable: false });
  try {
    const problems = bundleProblems({
      bundle,
      expected,
      plist: { ...plist, CFBundleShortVersionString: "0.1.0", LSMinimumSystemVersion: "11.0", CFBundleIdentifier: "com.example" },
    });
    assert.equal(problems.length, 7, problems.join("\n"));
    const report = problems.join("\n");
    assert.match(report, /CFBundleShortVersionString is "0\.1\.0", expected "0\.2\.0"/);
    assert.match(report, /CFBundleIdentifier is "com\.example"/);
    assert.match(report, /LSMinimumSystemVersion is "11\.0", expected "12\.0"/);
    assert.match(report, /no runnable the application executable/);
    assert.match(report, /bundled ffmpeg reports 8\.1\.2, expected the pinned 8\.1\.3/);
    assert.match(report, /no runnable ffprobe sidecar/);
    assert.match(report, /THIRD_PARTY_NOTICES\.md differs/);
  } finally {
    remove();
  }
});

test("reports missing notices and a sidecar that does not run", () => {
  const { bundle, remove } = fakeBundle({ notices: null });
  try {
    const problems = bundleProblems({ bundle, expected, plist, versionOf: () => "" });
    assert.deepEqual(problems, [
      "The bundled ffmpeg reports no version, expected the pinned 8.1.3.",
      "The bundled ffprobe reports no version, expected the pinned 8.1.3.",
      "The bundle has no Contents/Resources/THIRD_PARTY_NOTICES.md.",
    ]);
  } finally {
    remove();
  }
});

test("the repository asks for one macOS version in the application and in the engine", async () => {
  const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const repository = await expectedBundle(rootDirectory);
  assert.equal(repository.identifier, "io.github.mathieumaf.vidra");
  assert.equal(repository.minimumSystemVersion, "12.0");
  assert.equal(repository.ffmpegVersion, "8.1.3");
  assert.match(repository.version, /^\d+\.\d+\.\d+$/);
  assert.match(repository.notices, /FFmpeg/);
});
