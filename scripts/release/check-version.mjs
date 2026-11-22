import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotes } from "./release-notes.mjs";
import { isOfficialVersion, versionFromReleaseTag } from "./version.mjs";

// pnpm release:check              the four version files agree on one official version
// pnpm release:check -- v0.2.0    and that version is this tag, with dated release notes

/**
 * Returns the release version. Throws when the version files disagree, when
 * the version is not a plain X.Y.Z, or, for a tag, when the tag is not exactly
 * that version or the changelog has no dated section for it.
 */
export function checkRelease({ versions, tag, changelog }) {
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    const details = Object.entries(versions).map(([file, version]) => `${file}: ${version}`).join("\n");
    throw new Error(`Release versions do not match:\n${details}`);
  }
  const [version] = unique;
  if (!isOfficialVersion(version)) {
    throw new Error(`Application version ${version} is not a plain X.Y.Z version. Vidra publishes official releases only.`);
  }
  if (tag === undefined) return version;

  if (versionFromReleaseTag(tag) !== version) {
    throw new Error(`Tag ${tag} does not match application version ${version}. Tag v${version}, or change the version first.`);
  }
  // Throws when CHANGELOG.md has no dated section with notes for this version.
  releaseNotes(changelog, version);
  return version;
}

function cargoLockVersion(lock) {
  const match = lock.match(/\[\[package\]\]\nname = "vidra"\nversion = "([^"]+)"/);
  if (!match) throw new Error("Could not read the vidra package version from src-tauri/Cargo.lock.");
  return match[1];
}

function cargoManifestVersion(manifest) {
  const match = manifest.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Could not read the package version from src-tauri/Cargo.toml.");
  return match[1];
}

export async function readVersions(rootDirectory) {
  const read = (...path) => readFile(join(rootDirectory, ...path), "utf8");
  return {
    "package.json": JSON.parse(await read("package.json")).version,
    "src-tauri/tauri.conf.json": JSON.parse(await read("src-tauri", "tauri.conf.json")).version,
    "src-tauri/Cargo.toml": cargoManifestVersion(await read("src-tauri", "Cargo.toml")),
    "src-tauri/Cargo.lock": cargoLockVersion(await read("src-tauri", "Cargo.lock")),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tag = process.argv.slice(2).find((argument) => argument !== "--");
  const version = checkRelease({
    versions: await readVersions(rootDirectory),
    tag,
    changelog: await readFile(join(rootDirectory, "CHANGELOG.md"), "utf8"),
  });
  console.log(`Vidra ${version} is consistent in every version file${tag ? `, matches tag ${tag}, and has dated release notes` : ""}.`);
}
