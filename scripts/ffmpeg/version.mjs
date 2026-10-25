/**
 * Compare an FFmpeg or FFprobe `-version` report with a pinned release version.
 * The token after `version` must be that version. A single leading `n` from
 * FFmpeg's git describe is ignored. `8.1` does not satisfy `8.1.3`, and a
 * packager suffix such as `7.1.5-0ubuntu1` does not satisfy `7.1.5`.
 */
export function ffmpegVersionToken(versionOutput) {
  const line = String(versionOutput)
    .split(/\r?\n/)
    .find((entry) => entry.trim()) ?? "";
  const match = line.match(/(?:^|\s)version\s+(\S+)/);
  return match?.[1] ?? "";
}

export function comparableFfmpegVersion(versionOutput) {
  const token = ffmpegVersionToken(versionOutput);
  if (/^n\d/.test(token)) return token.slice(1);
  return token;
}

export function ffmpegVersionMatches(versionOutput, expected) {
  return comparableFfmpegVersion(versionOutput) === expected;
}

export function pinnedReleaseFfmpegVersion(manifest) {
  const version = manifest?.targets?.["aarch64-apple-darwin"]?.release?.sources?.ffmpeg?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("The pinned release FFmpeg version is missing from sources.json.");
  }
  return version;
}
