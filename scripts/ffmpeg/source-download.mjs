import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Transport fallback only: every location must serve the exact bytes pinned in
// sources.json. Download locations do not change the compiled release recipe.
const sourceMirrors = {
  "https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz": [
    "https://ftp.osuosl.org/pub/xiph/releases/opus/opus-1.5.2.tar.gz",
  ],
};

export async function ensureDownloaded(artifact, directory, mirrors = sourceMirrors[artifact.url] ?? []) {
  const archive = join(directory, artifact.archiveName);
  const temporary = `${archive}.partial`;
  await rm(temporary, { force: true });
  if (await exists(archive)) {
    if ((await sha256(archive)) === artifact.sha256) return archive;
    await rm(archive, { force: true });
  }

  const failures = [];
  for (const url of [artifact.url, ...mirrors]) {
    console.log(`Downloading ${artifact.archiveName} from ${url}...`);
    try {
      await execute("curl", [
        "--fail", "--location", "--silent", "--show-error",
        "--retry", "3", "--retry-all-errors", "--retry-delay", "1",
        "--connect-timeout", "15", "--max-time", "120", "--retry-max-time", "300",
        url, "--output", temporary,
      ], {
        // A final attempt may start just before curl's retry window ends.
        timeout: 425_000,
      });
      const digest = await sha256(temporary);
      if (digest !== artifact.sha256) {
        throw new Error(`Checksum mismatch for ${artifact.archiveName}: expected ${artifact.sha256}, received ${digest}.`);
      }
      await rename(temporary, archive);
      return archive;
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  throw new Error(`Unable to download verified ${artifact.archiveName}.\n${failures.join("\n")}`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
