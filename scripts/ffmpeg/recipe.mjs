import { createHash } from "node:crypto";

// Recipe 6. The fingerprint also covers the release source object, so a source
// pin change needs a new fingerprint assertion even when this number stays 6.
export const BUILD_RECIPE_VERSION = 6;

export function releaseRecipeFingerprint(release) {
  return createHash("sha256")
    .update(JSON.stringify({ version: BUILD_RECIPE_VERSION, release }))
    .digest("hex");
}
