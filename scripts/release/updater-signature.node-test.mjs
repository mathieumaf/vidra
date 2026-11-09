import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSignedVersionsMatch,
  signedUpdaterVersion,
  verifyUpdaterSignature,
} from "./updater-signature.mjs";
import { fixtureSignature, minisignKeyPair, trustedComment } from "./updater-signature-fixtures.mjs";

// The darwin-aarch64 signature published with v0.2.0-rc.2. The build signed it
// for the bundle version 0.2.0 while the manifest announced 0.2.0-rc.2.
const RC2_SIGNATURE = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTS2MvL2JIa2VobDRJajRsemVRcDc4c2NROW9MdjFrcnJKRU9BRGYveHZtOVZHM3RmUjR5bjVPQllHVi9xU3ltcFErTGw4MjFLTFBJaHBheWJ0N3VvbjNDbkNzVDc5OXdzPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0MTYxNjI1CWZpbGU6VmlkcmEuYXBwLnRhci5negl2ZXJzaW9uOjAuMi4wCkZxb1ozSFRvVTRrVTdKRG1OZHpqZG5uOXVQeFpPR1NxTnB1WGFBWmhUV0JVZy9PTXZZc1JYTUlxb01idEJTY3AwMUhKZ3paSHBpeXJ1eGptNGg5NUR3PT0K";

const archive = Buffer.from("updater archive");

test("verifies an archive signature and reads the version it is bound to", () => {
  const keys = minisignKeyPair();
  const signature = keys.sign(archive, trustedComment("0.2.0-rc.3"));
  assert.equal(verifyUpdaterSignature({ data: archive, signature, publicKey: keys.publicKey }).version, "0.2.0-rc.3");
  assert.equal(signedUpdaterVersion(signature), "0.2.0-rc.3");
});

test("rejects a modified archive, another key, or an unauthenticated trusted comment", () => {
  const keys = minisignKeyPair();
  const signature = keys.sign(archive, trustedComment("0.2.0"));
  assert.throws(() => verifyUpdaterSignature({ data: Buffer.from("other archive"), signature, publicKey: keys.publicKey }), /does not match the updater archive/);
  assert.throws(() => verifyUpdaterSignature({ data: archive, signature, publicKey: minisignKeyPair().publicKey }), /different key/);

  const decoded = Buffer.from(signature, "base64").toString("utf8");
  const relabelled = Buffer.from(decoded.replace("version:0.2.0", "version:0.2.0-rc.2")).toString("base64");
  assert.equal(signedUpdaterVersion(relabelled), "0.2.0-rc.2");
  assert.throws(() => verifyUpdaterSignature({ data: archive, signature: relabelled, publicKey: keys.publicKey }), /trusted comment is not authenticated/);
});

test("rejects the published 0.2.0-rc.2 manifest whose signature is bound to 0.2.0", () => {
  assert.equal(signedUpdaterVersion(RC2_SIGNATURE), "0.2.0");
  const manifest = {
    version: "0.2.0-rc.2",
    platforms: { "darwin-aarch64": { url: "https://example.com/Vidra.app.tar.gz", signature: RC2_SIGNATURE } },
  };
  assert.throws(() => assertSignedVersionsMatch(manifest), /bound to version 0\.2\.0, but the manifest announces 0\.2\.0-rc\.2/);
  assert.doesNotThrow(() => assertSignedVersionsMatch({ ...manifest, version: "0.2.0" }));
});

test("checks every platform and requires a signed version", () => {
  const platforms = (signatures) => Object.fromEntries(signatures.map((signature, index) => (
    [`platform-${index}`, { url: "https://example.com/Vidra.app.tar.gz", signature }]
  )));
  assert.doesNotThrow(() => assertSignedVersionsMatch({ version: "0.2.0-rc.3", platforms: platforms([fixtureSignature("0.2.0-rc.3"), fixtureSignature("0.2.0-rc.3")]) }));
  assert.throws(() => assertSignedVersionsMatch({ version: "0.2.0-rc.3", platforms: platforms([fixtureSignature("0.2.0-rc.3"), fixtureSignature("0.2.0")]) }), /platform-1/);
  assert.throws(() => assertSignedVersionsMatch({ version: "0.2.0", platforms: platforms([fixtureSignature(null)]) }), /does not record the version/);
  assert.throws(() => assertSignedVersionsMatch({ version: "0.2.0", platforms: platforms(["signed"]) }), /minisign|base64/);
});
