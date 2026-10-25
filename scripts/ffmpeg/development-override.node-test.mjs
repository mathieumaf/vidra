import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { developmentOverrideMarker, installDevelopmentSidecars } from "./development-override.mjs";

test("copies local ffmpeg and ffprobe into sidecar names and drops stale checksum markers", async () => {
  const root = await mkdtemp(join(tmpdir(), "vidra-ffmpeg-override-"));
  const sourceDirectory = join(root, "source");
  const binaryDirectory = join(root, "binaries");
  const target = "x86_64-unknown-linux-gnu";
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "ffmpeg"), "ffmpeg-bytes");
  await writeFile(join(sourceDirectory, "ffprobe"), "ffprobe-bytes");
  await writeFile(join(binaryDirectory, `.ffmpeg-${target}.sha256`), "stale\n");

  try {
    await installDevelopmentSidecars({ sourceDirectory, target, binaryDirectory });

    assert.equal(await readFile(join(binaryDirectory, `ffmpeg-${target}`), "utf8"), "ffmpeg-bytes");
    assert.equal(await readFile(join(binaryDirectory, `ffprobe-${target}`), "utf8"), "ffprobe-bytes");
    const mode = (await stat(join(binaryDirectory, `ffmpeg-${target}`))).mode & 0o777;
    assert.equal(mode, 0o755);
    await assert.rejects(stat(join(binaryDirectory, `.ffmpeg-${target}.sha256`)));
    assert.equal(await readFile(developmentOverrideMarker(binaryDirectory, target), "utf8"), "development-override\n");
    assert.equal(
      developmentOverrideMarker(binaryDirectory, target),
      join(binaryDirectory, ".ffmpeg-development-override-x86_64-unknown-linux-gnu"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a missing local binary by name", async () => {
  const root = await mkdtemp(join(tmpdir(), "vidra-ffmpeg-override-missing-"));
  const sourceDirectory = join(root, "source");
  await mkdir(sourceDirectory, { recursive: true });

  try {
    await assert.rejects(
      installDevelopmentSidecars({
        sourceDirectory,
        target: "x86_64-unknown-linux-gnu",
        binaryDirectory: join(root, "binaries"),
      }),
      /does not contain ffmpeg/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
