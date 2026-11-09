import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

// Test helpers that produce Tauri updater signatures in the minisign format.

const base64 = (value) => Buffer.from(value).toString("base64");

export function trustedComment(version) {
  return `timestamp:1794161625\tfile:Vidra.app.tar.gz${version === null ? "" : `\tversion:${version}`}`;
}

export function minisignKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = randomBytes(8);
  const rawPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    publicKey: base64(`untrusted comment: minisign public key\n${base64(Buffer.concat([Buffer.from("Ed"), keyId, rawPublicKey]))}\n`),
    sign(data, comment) {
      const signature = sign(null, createHash("blake2b512").update(data).digest(), privateKey);
      const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
      return base64([
        "untrusted comment: signature from tauri secret key",
        base64(Buffer.concat([Buffer.from("ED"), keyId, signature])),
        `trusted comment: ${comment}`,
        base64(globalSignature),
        "",
      ].join("\n"));
    },
  };
}

// A well-formed signature whose bytes are not cryptographically valid. Use it
// where only the signed version matters.
export function fixtureSignature(version) {
  return base64([
    "untrusted comment: signature from tauri secret key",
    base64(Buffer.concat([Buffer.from("ED"), Buffer.alloc(72)])),
    `trusted comment: ${trustedComment(version)}`,
    base64(Buffer.alloc(64)),
    "",
  ].join("\n"));
}
