import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { completionMarker } from "./update-feed.mjs";

// node scripts/release/mark-complete.mjs <release.json> <tag> <commit> <output>
//
// The last thing the release workflow does. release.json is the output of
// `gh release view <tag> --json assets`, read after every upload. The marker
// is written only when the draft has every kind of asset and every FFmpeg
// source archive the recipe pins. The update feed refuses a release without it.

const [releasePath, tag, commit, outputPath] = process.argv.slice(2);
if (!releasePath || !tag || !commit || !outputPath) {
  throw new Error("Usage: mark-complete.mjs <release.json> <tag> <commit> <output>");
}
const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const recipe = JSON.parse(await readFile(join(rootDirectory, "scripts", "ffmpeg", "sources.json"), "utf8"));
const marker = completionMarker({
  tag,
  commit,
  assets: JSON.parse(await readFile(releasePath, "utf8")).assets,
  sourceArchives: Object.values(recipe.targets["aarch64-apple-darwin"].sources).map((source) => source.archiveName),
});
await writeFile(outputPath, `${JSON.stringify(marker, null, 2)}\n`);
console.log(`Release ${tag} is complete: ${marker.assets.length} assets.`);
