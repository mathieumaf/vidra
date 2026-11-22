import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { minisignKeyPair, trustedComment } from "./updater-signature-fixtures.mjs";
import { verifyUpdaterManifest } from "./verify-updater-manifest.mjs";

const ARCHIVE_URL = "https://api.github.com/repos/test/vidra/releases/assets/42";
const assets = [{ name: "Vidra_0.2.0_aarch64.app.tar.gz", apiUrl: ARCHIVE_URL }];
const archive = Buffer.from("updater archive built on the runner");
const keys = minisignKeyPair();
const signatureFor = (version, data = archive, signer = keys) => signer.sign(data, trustedComment(version));
const manifestWith = (signature, version = "0.2.0") => ({
  version,
  platforms: { "darwin-aarch64": { url: ARCHIVE_URL, signature }, "darwin-aarch64-app": { url: ARCHIVE_URL, signature } },
});
const verify = (overrides = {}) => {
  const archiveSignature = overrides.archiveSignature ?? signatureFor("0.2.0");
  return verifyUpdaterManifest({
    manifest: manifestWith(archiveSignature),
    tag: "v0.2.0",
    assets,
    archive,
    archiveSignature,
    publicKey: keys.publicKey,
    ...overrides,
  });
};

test("accepts a manifest whose signatures verify the runner-built archive for the tag's version", () => {
  assert.equal(verify(), "0.2.0");
});

test("refuses the mismatch that made the 0.2.0-rc.2 update impossible to install", () => {
  // Announced 0.2.1, signed for 0.2.0.
  const signedForBundle = signatureFor("0.2.0");
  assert.throws(
    () => verify({ manifest: manifestWith(signedForBundle, "0.2.1"), tag: "v0.2.1", archiveSignature: signedForBundle }),
    /bound to version 0\.2\.0, but the manifest announces 0\.2\.1/,
  );
});

test("refuses another archive, another key, or a signature only in the manifest", () => {
  assert.throws(() => verify({ archive: Buffer.from("another archive") }), /does not match the updater archive/);
  assert.throws(() => verify({ publicKey: minisignKeyPair().publicKey }), /different key/);
  // The manifest carries a signature made over other bytes than the built archive.
  const foreign = signatureFor("0.2.0", Buffer.from("another archive"));
  assert.throws(
    () => verify({ manifest: manifestWith(foreign) }),
    /does not match the updater archive/,
  );
  // The .sig file next to the archive must verify too, and for the same version.
  assert.throws(
    () => verify({ manifest: manifestWith(signatureFor("0.2.0")), archiveSignature: signatureFor("0.1.0") }),
    /signed for version 0\.1\.0, not 0\.2\.0/,
  );
});

test("the command line reads the committed public key and rejects an archive it did not sign", () => {
  const directory = mkdtempSync(join(tmpdir(), "vidra-verify-manifest-"));
  try {
    const signature = signatureFor("0.2.0");
    const archivePath = join(directory, "Vidra.app.tar.gz");
    writeFileSync(archivePath, archive);
    writeFileSync(`${archivePath}.sig`, `${signature}\n`);
    writeFileSync(join(directory, "latest.json"), JSON.stringify(manifestWith(signature)));
    writeFileSync(join(directory, "release.json"), JSON.stringify({ assets }));
    assert.throws(
      () => execFileSync(process.execPath, [
        resolve(import.meta.dirname, "verify-updater-manifest.mjs"),
        join(directory, "latest.json"), "v0.2.0", archivePath, join(directory, "release.json"),
      ], { encoding: "utf8", stdio: "pipe" }),
      /different key than the committed public key/,
    );
    assert.throws(
      () => execFileSync(process.execPath, [resolve(import.meta.dirname, "verify-updater-manifest.mjs")], { encoding: "utf8", stdio: "pipe" }),
      /Usage: verify-updater-manifest\.mjs/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
