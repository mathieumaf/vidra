import { spawnSync } from "node:child_process";
import { chmod, open, rename, rm } from "node:fs/promises";

export async function extractArchiveEntry(archive, entry, destination) {
  const temporaryDestination = `${destination}.tmp`;
  const output = await open(temporaryDestination, "w");
  const extraction = spawnSync("tar", ["-xOf", archive, entry], {
    stdio: ["ignore", output.fd, "pipe"],
    encoding: "utf8",
  });
  await output.close();

  if (extraction.status !== 0) {
    await rm(temporaryDestination, { force: true });
    const detail = extraction.stderr?.trim() || `tar exited with status ${extraction.status ?? "unknown"}.`;
    throw new Error(`Unable to extract ${entry}: ${detail}`);
  }

  await chmod(temporaryDestination, 0o755);
  await rename(temporaryDestination, destination);
}
