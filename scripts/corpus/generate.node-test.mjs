import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CORPUS_GENERATOR_ID,
  DOLBY_VISION_SKIP_REASON,
  h264SdrArguments,
  hevcColorArguments,
  masteringDisplayBoxes,
  prepareOutputDirectory,
  resolveSidecars,
} from "./generate.mjs";

test("prefers prepared sidecar filenames over VIDRA_FFMPEG_DIR", () => {
  const root = mkdtempSync(join(tmpdir(), "vidra-sidecars-"));
  const present = new Set([
    join(root, "ffmpeg-aarch64-apple-darwin"),
    join(root, "ffprobe-aarch64-apple-darwin"),
    join(root, "override", "ffmpeg"),
    join(root, "override", "ffprobe"),
  ]);
  try {
    const resolved = resolveSidecars({
      ffmpegDir: join(root, "override"),
      binaryDirectory: root,
      target: "aarch64-apple-darwin",
      exists: (path) => present.has(path),
    });
    assert.equal(resolved.source, "sidecar");
    assert.equal(resolved.ffmpeg, join(root, "ffmpeg-aarch64-apple-darwin"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses VIDRA_FFMPEG_DIR when the sidecar files are absent", () => {
  const root = mkdtempSync(join(tmpdir(), "vidra-sidecars-"));
  const override = join(root, "override");
  const present = new Set([join(override, "ffmpeg"), join(override, "ffprobe")]);
  try {
    const resolved = resolveSidecars({
      ffmpegDir: override,
      binaryDirectory: join(root, "missing"),
      target: "x86_64-unknown-linux-gnu",
      exists: (path) => present.has(path),
    });
    assert.equal(resolved.source, "VIDRA_FFMPEG_DIR");
    assert.equal(resolved.ffprobe, join(override, "ffprobe"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explains how to provide FFmpeg when neither location has it", () => {
  assert.throws(
    () => resolveSidecars({
      ffmpegDir: "",
      binaryDirectory: join(tmpdir(), "vidra-missing-sidecars"),
      target: "x86_64-unknown-linux-gnu",
      exists: () => false,
    }),
    /pnpm ffmpeg:prepare/,
  );
});

test("mastering display metadata uses the ISO BMFF box layout", () => {
  const boxes = masteringDisplayBoxes();
  assert.equal(boxes.readUInt32BE(0), 32);
  assert.equal(boxes.toString("ascii", 4, 8), "mdcv");
  assert.equal(boxes.readUInt16BE(8), 13250);
  assert.equal(boxes.readUInt16BE(10), 34500);
  assert.equal(boxes.readUInt16BE(12), 7500);
  assert.equal(boxes.readUInt16BE(14), 3000);
  assert.equal(boxes.readUInt16BE(16), 34000);
  assert.equal(boxes.readUInt16BE(18), 16000);
  assert.equal(boxes.readUInt16BE(20), 15635);
  assert.equal(boxes.readUInt16BE(22), 16450);
  assert.equal(boxes.readUInt32BE(24), 10_000_000);
  assert.equal(boxes.readUInt32BE(28), 1);

  const contentLight = boxes.subarray(32);
  assert.equal(contentLight.readUInt32BE(0), 12);
  assert.equal(contentLight.toString("ascii", 4, 8), "clli");
  assert.equal(contentLight.readUInt16BE(8), 1000);
  assert.equal(contentLight.readUInt16BE(10), 400);
});

test("tags lavfi frames with setparams before encoding", () => {
  const sdr = h264SdrArguments().join(" ");
  assert.match(sdr, /setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv/);
  assert.doesNotMatch(sdr, /-color_trc/);
  assert.doesNotMatch(sdr, /h264_metadata/);

  const hdr10 = hevcColorArguments("smpte2084", true).join(" ");
  assert.match(hdr10, /setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv/);
  assert.match(hdr10, /master-display=/);
  assert.match(hdr10, /max-cll=1000,400/);
  assert.doesNotMatch(hdr10, /hevc_metadata/);

  const unknown = hevcColorArguments().join(" ");
  assert.match(unknown, /setparams=color_primaries=bt2020:colorspace=bt2020nc:range=tv/);
  assert.doesNotMatch(unknown, /color_trc/);
  assert.doesNotMatch(unknown, /master-display/);
});

test("refuses to wipe a folder that is not a previous corpus", async () => {
  const root = mkdtempSync(join(tmpdir(), "vidra-corpus-out-"));
  const output = join(root, "clips");
  await mkdir(output);
  await writeFile(join(output, "holiday.mp4"), "keep");
  try {
    await assert.rejects(
      () => prepareOutputDirectory(output),
      /not empty/,
    );
    assert.equal(await readFile(join(output, "holiday.mp4"), "utf8"), "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces only files written by a previous corpus", async () => {
  const root = mkdtempSync(join(tmpdir(), "vidra-corpus-out-"));
  const output = join(root, "clips");
  await mkdir(output);
  await writeFile(join(output, "manifest.json"), JSON.stringify({
    generator: CORPUS_GENERATOR_ID,
    clips: [{ id: "sdr-h264-aac", path: join(output, "sdr-h264-aac.mp4"), role: "representative" }],
  }));
  await writeFile(join(output, "sdr-h264-aac.mp4"), "old");
  try {
    await prepareOutputDirectory(output);
    assert.deepEqual(await readdir(output), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("leaves an unrelated file next to a corpus manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "vidra-corpus-out-"));
  const output = join(root, "clips");
  await mkdir(output);
  await writeFile(join(output, "manifest.json"), JSON.stringify({
    generator: CORPUS_GENERATOR_ID,
    clips: [],
  }));
  await writeFile(join(output, "holiday.mp4"), "keep");
  try {
    await assert.rejects(
      () => prepareOutputDirectory(output),
      /holiday\.mp4/,
    );
    assert.equal(await readFile(join(output, "holiday.mp4"), "utf8"), "keep");
    assert.equal((await readFile(join(output, "manifest.json"), "utf8")).includes(CORPUS_GENERATOR_ID), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("records why a synthetic Dolby Vision clip is not normally available", () => {
  assert.match(DOLBY_VISION_SKIP_REASON, /dolby-vision-rpu/);
  assert.match(DOLBY_VISION_SKIP_REASON, /HDR10 and HLG/);
});
