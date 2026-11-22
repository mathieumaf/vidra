import { arch, platform } from "node:os";

// Rust target triples used in Tauri sidecar filenames. Node's platform and
// architecture names differ from Rust's.
const HOST_TARGET_TRIPLES = {
  "darwin:arm64": "aarch64-apple-darwin",
  "darwin:x64": "x86_64-apple-darwin",
  "linux:x64": "x86_64-unknown-linux-gnu",
  "linux:arm64": "aarch64-unknown-linux-gnu",
  "win32:x64": "x86_64-pc-windows-msvc",
  "win32:arm64": "aarch64-pc-windows-msvc",
};

export function hostTargetTriple(hostPlatform = platform(), hostArchitecture = arch()) {
  const target = HOST_TARGET_TRIPLES[`${hostPlatform}:${hostArchitecture}`];
  if (!target) {
    throw new Error(`Unsupported target ${hostPlatform}/${hostArchitecture}.`);
  }
  return target;
}

/** The pinned sources and build settings of the FFmpeg engine for one target. */
export function recipeEntry(manifest, target) {
  const entry = manifest?.targets?.[target];
  if (!entry || entry.target !== target) {
    throw new Error(
      `Unsupported target ${target}. Vidra pins an FFmpeg engine for macOS on Apple Silicon only.`,
    );
  }
  return entry;
}
