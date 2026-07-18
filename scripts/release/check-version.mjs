import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, "..", "..");
const packageManifest = JSON.parse(await readFile(join(rootDirectory, "package.json"), "utf8"));
const tauriManifest = JSON.parse(await readFile(join(rootDirectory, "src-tauri", "tauri.conf.json"), "utf8"));
const cargoManifest = await readFile(join(rootDirectory, "src-tauri", "Cargo.toml"), "utf8");
const cargoPackage = cargoManifest.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);

if (!cargoPackage) {
  throw new Error("Could not read the package version from src-tauri/Cargo.toml.");
}

const versions = new Map([
  ["package.json", packageManifest.version],
  ["src-tauri/tauri.conf.json", tauriManifest.version],
  ["src-tauri/Cargo.toml", cargoPackage[1]],
]);
const uniqueVersions = new Set(versions.values());

if (uniqueVersions.size !== 1) {
  const details = [...versions].map(([file, version]) => `${file}: ${version}`).join("\n");
  throw new Error(`Release versions do not match:\n${details}`);
}

const version = packageManifest.version;
const tag = process.argv.slice(2).find((argument) => argument !== "--") ?? process.env.GITHUB_REF_NAME;
if (tag && tag !== `v${version}` && !tag.startsWith(`v${version}-`)) {
  throw new Error(`Tag ${tag} does not match application version ${version}. Use v${version} or v${version}-<prerelease>.`);
}

console.log(`Vidra ${version} version metadata is consistent${tag ? ` with tag ${tag}` : ""}.`);
