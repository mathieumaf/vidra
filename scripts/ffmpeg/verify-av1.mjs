import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the release binaries themselves: listing a decoder does not prove
// that automatic selection works without hardware decoding on an older Mac.
export async function verifyAv1Decoding(ffmpeg, ffprobe) {
  const directory = await mkdtemp(join(tmpdir(), "vidra-av1-check-"));
  try {
    for (const bitDepth of [8, 10]) {
      const pixelFormat = bitDepth === 8 ? "yuv420p" : "yuv420p10le";
      for (const container of ["mp4", "mkv"]) {
        const input = join(directory, `av1-${bitDepth}.${container}`);
        const raw = join(directory, "decoded.yuv");
        const output = join(directory, "converted.mp4");
        run(ffmpeg, [
          "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=6:duration=1",
          "-c:v", "libsvtav1", "-preset", "12", "-crf", "40",
          "-pix_fmt", pixelFormat,
          ...(container === "mp4" ? ["-tag:v", "av01"] : []),
          input,
        ]);

        const source = probe(ffprobe, input);
        assert.equal(source.codec_name, "av1");
        assert.equal(source.pix_fmt, pixelFormat);
        assert.equal(Number(source.nb_read_frames), 6, `FFprobe must decode all AV1 ${bitDepth}-bit ${container} frames.`);

        // Do not force libdav1d: Vidra relies on FFmpeg's default decoder.
        run(ffmpeg, [
          "-hwaccel", "none", "-i", input, "-map", "0:v:0",
          "-pix_fmt", pixelFormat, "-fps_mode", "passthrough",
          "-f", "rawvideo", raw,
        ]);
        const bytesPerSample = bitDepth === 8 ? 1 : 2;
        assert.equal((await stat(raw)).size, 320 * 180 * 1.5 * bytesPerSample * 6);

        run(ffmpeg, [
          "-hwaccel", "none", "-i", input, "-map", "0:v:0",
          "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
          output,
        ]);
        const converted = probe(ffprobe, output);
        assert.equal(converted.codec_name, "h264");
        assert.equal(Number(converted.nb_read_frames), 6);
        assert.equal(converted.width, 320);
        assert.equal(converted.height, 180);
        console.log(`AV1 ${bitDepth}-bit ${container}: inspection, software decoding, and H.264 conversion passed.`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function probe(ffprobe, path) {
  const result = run(ffprobe, [
    "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_read_frames",
    "-of", "json", path,
  ], false);
  return JSON.parse(result).streams[0];
}

function run(binary, args, encode = true) {
  const result = spawnSync(binary, [
    "-v", "error", ...(encode ? ["-nostdin", "-y", "-xerror"] : []), ...args,
  ], { encoding: "utf8", timeout: 120_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`AV1 validation failed: ${binary} ${args.join(" ")}\n${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , ffmpeg, ffprobe] = process.argv;
  if (!ffmpeg || !ffprobe) {
    throw new Error("Usage: node scripts/ffmpeg/verify-av1.mjs <ffmpeg> <ffprobe>");
  }
  await verifyAv1Decoding(resolve(ffmpeg), resolve(ffprobe));
}
