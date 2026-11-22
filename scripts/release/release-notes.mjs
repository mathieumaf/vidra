import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { versionFromReleaseTag } from "./version.mjs";

// node scripts/release/release-notes.mjs v0.2.0   prints that release's changelog section

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The notes of one release: the body of its `## X.Y.Z - YYYY-MM-DD` section in
 * the changelog. A release cannot be tagged while its section is missing,
 * undated, or empty.
 */
export function releaseNotes(changelog, version) {
  const heading = new RegExp(`^## ${escape(version)}(?: - (.*))?$`, "m").exec(changelog);
  if (!heading) {
    throw new Error(`CHANGELOG.md has no "## ${version} - YYYY-MM-DD" section. Move the Unreleased notes under that heading.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(heading[1] ?? "")) {
    throw new Error(`The "## ${version}" section of CHANGELOG.md needs its release date: "## ${version} - YYYY-MM-DD".`);
  }
  const rest = changelog.slice(heading.index + heading[0].length);
  const next = rest.search(/^## /m);
  const notes = (next === -1 ? rest : rest.slice(0, next)).trim();
  if (!notes) {
    throw new Error(`The "## ${version}" section of CHANGELOG.md is empty.`);
  }
  return notes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tag = process.argv.slice(2).find((argument) => argument !== "--");
  const changelog = await readFile(join(rootDirectory, "CHANGELOG.md"), "utf8");
  console.log(releaseNotes(changelog, versionFromReleaseTag(tag)));
}
