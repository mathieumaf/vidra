import { createHash } from "node:crypto";

// Recipe 6. Raise this number when the build commands in build.mjs change.
// The fingerprint also covers the recipe entry in sources.json, so a source
// pin change produces a new fingerprint even when this number stays the same.
export const BUILD_RECIPE_VERSION = 6;

/**
 * Identity of one engine build: the build commands' version and the pinned
 * sources. The published engine archive records the fingerprint it was built
 * from, and preparing the engine refuses an archive built from another one.
 */
export function recipeFingerprint(recipe) {
  // The key is named `release` because published archives were fingerprinted
  // with it. Renaming it would invalidate every pinned archive.
  return createHash("sha256")
    .update(JSON.stringify({ version: BUILD_RECIPE_VERSION, release: recipe }))
    .digest("hex");
}
