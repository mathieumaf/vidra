import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractArchiveEntry } from "./archive.mjs";

test("extracts one nested executable from a tar archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "vidra-ffmpeg-archive-"));
  const source = join(root, "source");
  const archive = join(root, "engine.tar.gz");
  const destination = join(root, "ffmpeg");
  const entry = "Vidra.app/Contents/MacOS/ffmpeg";

  try {
    await mkdir(join(source, "Vidra.app", "Contents", "MacOS"), { recursive: true });
    await writeFile(join(source, entry), "engine-bytes");
    const packed = spawnSync("tar", ["-czf", archive, "-C", source, entry], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);

    await extractArchiveEntry(archive, entry, destination);

    assert.equal(await readFile(destination, "utf8"), "engine-bytes");
    assert.equal((await stat(destination)).mode & 0o777, 0o755);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a missing archive entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "vidra-ffmpeg-archive-missing-"));
  const source = join(root, "source");
  const archive = join(root, "engine.tar.gz");

  try {
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "readme.txt"), "notes");
    const packed = spawnSync("tar", ["-czf", archive, "-C", source, "readme.txt"], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    await assert.rejects(
      extractArchiveEntry(archive, "Vidra.app/Contents/MacOS/ffmpeg", join(root, "ffmpeg")),
      /Unable to extract Vidra\.app\/Contents\/MacOS\/ffmpeg/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
