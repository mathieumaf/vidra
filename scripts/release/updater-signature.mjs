import { createHash, createPublicKey, verify } from "node:crypto";

// Tauri updater signatures are base64-encoded minisign signature files. The
// trusted comment is covered by the global signature and records the version
// the archive was signed for. The updater rejects an update whose announced
// version differs from that signed version.

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeBase64(value, description) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error(`The ${description} is not valid base64.`);
  }
  return Buffer.from(text, "base64");
}

function minisignLines(value, description) {
  return decodeBase64(value, description).toString("utf8").split("\n").map((line) => line.replace(/\r$/, ""));
}

export function parseUpdaterSignature(value) {
  const lines = minisignLines(value, "updater signature");
  const trustedPrefix = "trusted comment: ";
  if (!lines[0]?.startsWith("untrusted comment:") || !lines[2]?.startsWith(trustedPrefix)) {
    throw new Error("The updater signature is not a minisign signature.");
  }
  const signatureBlock = decodeBase64(lines[1], "updater signature block");
  const globalSignature = decodeBase64(lines[3], "updater global signature");
  const algorithm = signatureBlock.subarray(0, 2).toString("latin1");
  if (signatureBlock.length !== 74 || globalSignature.length !== 64 || !["Ed", "ED"].includes(algorithm)) {
    throw new Error("The updater signature is not a minisign Ed25519 signature.");
  }
  const trustedComment = lines[2].slice(trustedPrefix.length);
  const versionField = trustedComment.split("\t").find((field) => field.startsWith("version:"));
  return {
    prehashed: algorithm === "ED",
    keyId: signatureBlock.subarray(2, 10),
    signature: signatureBlock.subarray(10),
    trustedComment,
    globalSignature,
    version: versionField ? versionField.slice("version:".length) : null,
  };
}

export function signedUpdaterVersion(value) {
  return parseUpdaterSignature(value).version;
}

function parsePublicKey(value) {
  const lines = minisignLines(value, "updater public key");
  const key = decodeBase64(lines[1], "updater public key block");
  if (!lines[0]?.startsWith("untrusted comment:") || key.length !== 42 || key.subarray(0, 2).toString("latin1") !== "Ed") {
    throw new Error("The updater public key is not a minisign Ed25519 public key.");
  }
  return {
    keyId: key.subarray(2, 10),
    key: createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, key.subarray(10)]), format: "der", type: "spki" }),
  };
}

// Mirrors the updater's verification: the archive signature, then the global
// signature that authenticates the trusted comment and its version.
export function verifyUpdaterSignature({ data, signature, publicKey }) {
  const parsed = parseUpdaterSignature(signature);
  const trusted = parsePublicKey(publicKey);
  if (!parsed.keyId.equals(trusted.keyId)) {
    throw new Error("The updater signature was made with a different key than the committed public key.");
  }
  const message = parsed.prehashed ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, message, trusted.key, parsed.signature)) {
    throw new Error("The updater signature does not match the updater archive.");
  }
  const globalMessage = Buffer.concat([parsed.signature, Buffer.from(parsed.trustedComment, "utf8")]);
  if (!verify(null, globalMessage, trusted.key, parsed.globalSignature)) {
    throw new Error("The updater signature's trusted comment is not authenticated.");
  }
  return parsed;
}

export function assertSignedVersionsMatch(manifest) {
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    const signedVersion = signedUpdaterVersion(entry.signature);
    if (signedVersion === null) {
      throw new Error(`The ${platform} updater signature does not record the version it was signed for.`);
    }
    if (signedVersion !== manifest.version) {
      throw new Error(
        `The ${platform} updater signature is bound to version ${signedVersion}, `
        + `but the manifest announces ${manifest.version}. The updater would reject this update.`,
      );
    }
  }
}
