import { chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const SIDECAR_NAMES = ["ffmpeg", "ffprobe"];

/**
 * Copy a local ffmpeg and ffprobe into Tauri's sidecar filenames.
 * This is a development and CI override for targets that do not yet have a
 * pinned sidecar. It is not a release build.
 */
export async function installDevelopmentSidecars({ sourceDirectory, target, binaryDirectory }) {
  await mkdir(binaryDirectory, { recursive: true });

  for (const name of SIDECAR_NAMES) {
    const source = join(sourceDirectory, name);
    let sourceStat;
    try {
      sourceStat = await stat(source);
    } catch {
      throw new Error(`VIDRA_FFMPEG_DIR does not contain ${name}. Expected ${source}.`);
    }
    if (!sourceStat.isFile()) {
      throw new Error(`VIDRA_FFMPEG_DIR ${name} must be a file. Expected ${source}.`);
    }

    const destination = join(binaryDirectory, `${name}-${target}`);
    await copyFile(source, destination);
    await chmod(destination, 0o755);
    await rm(join(binaryDirectory, `.${name}-${target}.sha256`), { force: true });
  }
}
