import { arch, platform } from "node:os";

// Rust target triples used in Tauri sidecar filenames. Node's platform and
// architecture names differ from Rust's, so both prepare scripts share this map.
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

export function developmentEntry(manifest, target) {
  const entry = manifest?.targets?.[target]?.development;
  if (!entry) {
    throw new Error(
      `Unsupported target ${target}. Pinned development FFmpeg sidecars are not available for this target. Set VIDRA_FFMPEG_DIR to a directory that contains ffmpeg and ffprobe.`,
    );
  }
  return entry;
}

export function releaseEntry(manifest, target) {
  const entry = manifest?.targets?.[target]?.release;
  if (!entry || entry.target !== target) {
    throw new Error(`Unsupported target ${target}. Release FFmpeg builds do not include this target.`);
  }
  return entry;
}

export function rejectReleaseDevelopmentOverride(mode, overrideDirectory) {
  if (mode === "release" && overrideDirectory) {
    throw new Error(
      "VIDRA_FFMPEG_DIR cannot be used for a release FFmpeg build. Release builds must use the pinned source recipe.",
    );
  }
}
