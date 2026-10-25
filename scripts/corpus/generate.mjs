import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostTargetTriple } from "../ffmpeg/target.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "..", "..");

const FRAME_SIZE = "64x64";
const FRAME_RATE = "12";
const DURATION = "0.5";
const FFMPEG_TIMEOUT_MS = 180_000;
export const CORPUS_GENERATOR_ID = "vidra-corpus";

// From FFmpeg 7 on, output options such as -color_trc are overwritten by the
// frame's own tags, and lavfi frames carry none. setparams writes the tags
// onto the frames, which is the same filter Vidra uses when it encodes.
export function setparamsFilter({ primaries, transfer, matrix, range = "tv" }) {
  const fields = [`color_primaries=${primaries}`];
  if (transfer) {
    fields.push(`color_trc=${transfer}`);
  }
  fields.push(`colorspace=${matrix}`, `range=${range}`);
  return `setparams=${fields.join(":")}`;
}

export function h264SdrArguments() {
  return [
    "-vf", setparamsFilter({ primaries: "bt709", transfer: "bt709", matrix: "bt709" }),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
  ];
}

export function hevcColorArguments(transfer, masteringDisplay = false) {
  const params = ["log-level=error"];
  if (masteringDisplay) {
    params.push(
      "master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)",
      "max-cll=1000,400",
    );
  }
  return [
    "-vf", setparamsFilter({ primaries: "bt2020", transfer, matrix: "bt2020nc" }),
    "-c:v", "libx265",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p10le",
    "-x265-params", params.join(":"),
  ];
}

const OWNED_FILE_NAMES = new Set([
  "manifest.json",
  "sdr-h264-aac.mp4",
  "hdr10-hevc.mp4",
  "hlg-hevc.mp4",
  "rotated-base.mp4",
  "rotated-h264.mp4",
  "vfr-fast.mp4",
  "vfr-slow.mp4",
  "vfr-list.txt",
  "variable-frame-rate.mp4",
  "corpus.srt",
  "mov-subtitles.mov",
  "audio-only.m4a",
  "corrupt.mp4",
  "unknown-transfer.mp4",
  "dolby-vision.mp4",
]);

// libx265 accepts a Dolby Vision profile, but the profile only becomes a
// DOVI configuration record when an RPU bitstream is supplied. lavfi cannot
// synthesize that RPU, and Vidra classifies Dolby Vision from FFprobe's
// stream side data. See `dolbyVisionSkipReason`.
export const DOLBY_VISION_SKIP_REASON = [
  "A Dolby Vision sample was not generated.",
  "libx265 can record a Dolby Vision profile only together with an external RPU bitstream (`dolby-vision-rpu`).",
  "lavfi has no source for that RPU, and this repository does not bundle Dolby's tools or dovi_tool.",
  "Without the RPU, FFprobe does not report Dolby Vision stream side data, which is what Vidra reads before allowing a re-encode.",
  "HDR10 and HLG clips still cover the backward-compatible base layer: H.264 tone-maps it to SDR, and H.265 and AV1 keep it as 10-bit video.",
].join(" ");

export function resolveSidecars({
  ffmpegDir = process.env.VIDRA_FFMPEG_DIR?.trim() ?? "",
  binaryDirectory = join(rootDirectory, "src-tauri", "binaries"),
  target = hostTargetTriple(),
  exists = existsSync,
} = {}) {
  const sidecarFfmpeg = join(binaryDirectory, `ffmpeg-${target}`);
  const sidecarFfprobe = join(binaryDirectory, `ffprobe-${target}`);
  if (exists(sidecarFfmpeg) && exists(sidecarFfprobe)) {
    return { ffmpeg: sidecarFfmpeg, ffprobe: sidecarFfprobe, source: "sidecar" };
  }
  if (ffmpegDir) {
    const ffmpeg = join(ffmpegDir, "ffmpeg");
    const ffprobe = join(ffmpegDir, "ffprobe");
    if (exists(ffmpeg) && exists(ffprobe)) {
      return { ffmpeg, ffprobe, source: "VIDRA_FFMPEG_DIR" };
    }
    throw new Error(
      `VIDRA_FFMPEG_DIR does not contain ffmpeg and ffprobe. Expected them in ${ffmpegDir}.`,
    );
  }
  throw new Error(
    `FFmpeg sidecars are missing (${sidecarFfmpeg}). Run pnpm ffmpeg:prepare, or set VIDRA_FFMPEG_DIR to a directory that contains ffmpeg and ffprobe.`,
  );
}

// ISO/IEC 14496-12 MasteringDisplayColourVolumeBox and ContentLightLevelBox.
// The file stores primaries in green, blue, red order. FFprobe then reports
// them as red, green, and blue on the video stream.
export function masteringDisplayBoxes() {
  const mdcv = Buffer.concat([
    u32(32),
    Buffer.from("mdcv"),
    u16(13250), u16(34500),
    u16(7500), u16(3000),
    u16(34000), u16(16000),
    u16(15635), u16(16450),
    u32(10_000_000),
    u32(1),
  ]);
  const clli = Buffer.concat([
    u32(12),
    Buffer.from("clli"),
    u16(1000),
    u16(400),
  ]);
  return Buffer.concat([mdcv, clli]);
}

export async function prepareOutputDirectory(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  if (entries.length === 0) {
    return;
  }
  const directory = resolve(outputDirectory);
  if (entries.some((entry) => entry.isSymbolicLink() || !entry.isFile())) {
    throw new Error(
      `Refusing to replace ${directory}: it contains a subdirectory or link. Choose an empty folder.`,
    );
  }
  const names = entries.map((entry) => entry.name);
  if (!names.includes("manifest.json")) {
    throw new Error(
      `Refusing to replace ${directory}: it is not empty and has no Vidra corpus manifest. Choose an empty folder.`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  } catch {
    throw new Error(`Refusing to replace ${directory}: manifest.json is not a Vidra corpus manifest.`);
  }
  if (manifest?.generator !== CORPUS_GENERATOR_ID) {
    throw new Error(
      `Refusing to replace ${directory}: manifest.json was not written by the Vidra corpus generator.`,
    );
  }
  const owned = new Set(OWNED_FILE_NAMES);
  for (const clip of manifest.clips ?? []) {
    const clipPath = clip?.path;
    if (typeof clipPath !== "string" || clipPath.length === 0) {
      continue;
    }
    const resolvedClip = resolve(clipPath);
    if (dirname(resolvedClip) === directory) {
      owned.add(basename(resolvedClip));
    }
  }
  const unexpected = names.filter((name) => !owned.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `Refusing to replace ${directory}: it contains files this generator did not write (${unexpected.join(", ")}).`,
    );
  }
  for (const name of names) {
    await rm(join(directory, name), { force: true });
  }
}

export async function generateCorpus(outputDirectory, sidecars = resolveSidecars()) {
  await prepareOutputDirectory(outputDirectory);

  const clips = [];
  const unavailable = [];
  const sdr = await writeSdr(sidecars, outputDirectory);
  clips.push(sdr);
  clips.push(await writeHdr(sidecars, outputDirectory, "hdr10-hevc", "smpte2084"));
  clips.push(await writeHdr(sidecars, outputDirectory, "hlg-hevc", "arib-std-b67"));
  clips.push(await writeRotated(sidecars, outputDirectory));
  clips.push(await writeVariableFrameRate(sidecars, outputDirectory));
  clips.push(await writeSubtitledMov(sidecars, outputDirectory));
  clips.push(await writeAudioOnly(sidecars, outputDirectory));
  clips.push(await writeCorrupt(sidecars, outputDirectory, sdr.path));
  clips.push(await writeUnknownTransfer(sidecars, outputDirectory));

  const dolbyVision = await tryDolbyVision(sidecars, outputDirectory);
  if (dolbyVision.clip) {
    clips.push(dolbyVision.clip);
  } else {
    unavailable.push({ id: "dolby-vision", reason: dolbyVision.reason });
  }

  const manifest = {
    generator: CORPUS_GENERATOR_ID,
    ffmpeg: sidecars.ffmpeg,
    ffprobe: sidecars.ffprobe,
    ffmpegVersion: ffmpegVersionLine(sidecars.ffmpeg),
    sidecarSource: sidecars.source,
    clips,
    unavailable,
  };
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function writeSdr(sidecars, directory) {
  const path = join(directory, "sdr-h264-aac.mp4");
  run(sidecars.ffmpeg, [
    ...lavfiVideo(),
    ...lavfiAudio(),
    ...h264SdrArguments(),
    "-c:a", "aac",
    "-shortest",
    path,
  ]);
  const video = videoStream(probe(sidecars.ffprobe, path));
  assertEqual(video.codec_name, "h264", "SDR clip video codec");
  assertEqual(video.color_transfer, "bt709", "SDR clip transfer");
  return clip("sdr-h264-aac", path, "representative");
}

async function writeHdr(sidecars, directory, id, transfer) {
  const path = join(directory, `${id}.mp4`);
  run(sidecars.ffmpeg, [
    ...lavfiVideo(),
    ...lavfiAudio(),
    ...hevcColorArguments(transfer, transfer === "smpte2084"),
    "-c:a", "aac",
    "-shortest",
    path,
  ]);
  const video = videoStream(probe(sidecars.ffprobe, path));
  assertEqual(video.codec_name, "hevc", `${id} codec`);
  assertEqual(video.pix_fmt, "yuv420p10le", `${id} pixel format`);
  assertEqual(video.color_transfer, transfer, `${id} transfer`);
  assertEqual(video.color_primaries, "bt2020", `${id} primaries`);
  if (transfer === "smpte2084" && !hasStaticHdrMetadata(video.side_data_list) && !hasStaticHdrMetadata(firstFrameSideData(sidecars.ffprobe, path))) {
    throw new Error("HDR10 clip is missing mastering display and content light metadata.");
  }
  return clip(id, path, transfer === "smpte2084" ? "hdr10" : "hlg");
}

async function writeRotated(sidecars, directory) {
  const base = join(directory, "rotated-base.mp4");
  const path = join(directory, "rotated-h264.mp4");
  run(sidecars.ffmpeg, [
    "-f", "lavfi", "-i", `testsrc2=size=96x64:rate=${FRAME_RATE}:duration=${DURATION}`,
    ...lavfiAudio(),
    ...h264SdrArguments(),
    "-c:a", "aac",
    "-shortest",
    base,
  ]);
  run(sidecars.ffmpeg, [
    "-display_rotation", "90",
    "-i", base,
    "-c", "copy",
    path,
  ]);
  await rm(base, { force: true });
  const video = videoStream(probe(sidecars.ffprobe, path));
  const rotation = (video.side_data_list ?? []).find((entry) => entry.rotation !== undefined);
  if (!rotation || Math.abs(Number(rotation.rotation)) % 180 !== 90) {
    throw new Error("The rotated clip has no 90 degree display matrix.");
  }
  assertEqual(video.width, 96, "rotated coded width");
  assertEqual(video.height, 64, "rotated coded height");
  return clip("rotated-h264", path, "rotated");
}

async function writeVariableFrameRate(sidecars, directory) {
  const fast = join(directory, "vfr-fast.mp4");
  const slow = join(directory, "vfr-slow.mp4");
  const list = join(directory, "vfr-list.txt");
  const path = join(directory, "variable-frame-rate.mp4");
  for (const [output, rate, duration] of [
    [fast, "30", "0.2"],
    [slow, "12", "0.25"],
  ]) {
    run(sidecars.ffmpeg, [
      "-f", "lavfi", "-i", `testsrc2=size=${FRAME_SIZE}:rate=${rate}:duration=${duration}`,
      ...h264SdrArguments(),
      output,
    ]);
  }
  await writeFile(list, `file '${fast}'\nfile '${slow}'\n`);
  run(sidecars.ffmpeg, ["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", path]);
  await rm(fast, { force: true });
  await rm(slow, { force: true });
  await rm(list, { force: true });
  const frames = probeFrames(sidecars.ffprobe, path);
  const deltas = new Set();
  for (let index = 1; index < frames.length; index += 1) {
    deltas.add(Math.round((Number(frames[index].pts_time) - Number(frames[index - 1].pts_time)) * 1000));
  }
  if (deltas.size < 2) {
    throw new Error("The variable-frame-rate clip has only one frame duration.");
  }
  return clip("variable-frame-rate", path, "variable-frame-rate");
}

async function writeSubtitledMov(sidecars, directory) {
  const subtitles = join(directory, "corpus.srt");
  const path = join(directory, "mov-subtitles.mov");
  await writeFile(subtitles, "1\n00:00:00,000 --> 00:00:00,400\nCorpus subtitle\n");
  run(sidecars.ffmpeg, [
    ...lavfiVideo(),
    ...lavfiAudio(),
    "-i", subtitles,
    ...h264SdrArguments(),
    "-c:a", "aac",
    "-c:s", "mov_text",
    "-shortest",
    "-f", "mov",
    path,
  ]);
  await rm(subtitles, { force: true });
  const streams = probe(sidecars.ffprobe, path).streams ?? [];
  const subtitle = streams.find((stream) => stream.codec_type === "subtitle");
  assertEqual(subtitle?.codec_name, "mov_text", "MOV subtitle codec");
  return clip("mov-subtitles", path, "subtitles");
}

async function writeAudioOnly(sidecars, directory) {
  const path = join(directory, "audio-only.m4a");
  run(sidecars.ffmpeg, [
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${DURATION}`,
    "-c:a", "aac", "-b:a", "96k",
    path,
  ]);
  const streams = probe(sidecars.ffprobe, path).streams ?? [];
  if (streams.some((stream) => stream.codec_type === "video")) {
    throw new Error("The audio-only clip contains video.");
  }
  if (!streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error("The audio-only clip has no audio stream.");
  }
  return clip("audio-only", path, "audio-only");
}

async function writeCorrupt(sidecars, directory, source) {
  const path = join(directory, "corrupt.mp4");
  const bytes = await readFile(source);
  await writeFile(path, bytes.subarray(0, Math.min(48, bytes.length)));
  const probeResult = spawnSync(sidecars.ffprobe, [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", path,
  ], { encoding: "utf8" });
  if (probeResult.status === 0) {
    throw new Error("The truncated clip was readable. It must fail inspection.");
  }
  return clip("corrupt", path, "corrupt");
}

async function writeUnknownTransfer(sidecars, directory) {
  const path = join(directory, "unknown-transfer.mp4");
  run(sidecars.ffmpeg, [
    ...lavfiVideo(),
    ...hevcColorArguments(),
    path,
  ]);
  insertStreamHdrMetadata(path);
  run(sidecars.ffmpeg, ["-v", "error", "-i", path, "-f", "null", "-"]);
  const video = videoStream(probe(sidecars.ffprobe, path));
  const sideData = (video.side_data_list ?? [])
    .map((entry) => entry.side_data_type ?? "")
    .join(" ")
    .toLowerCase();
  if (isSpecifiedTransfer(video.color_transfer)) {
    throw new Error(`Unknown-transfer clip reported transfer ${video.color_transfer}.`);
  }
  if (!sideData.includes("mastering display metadata")) {
    throw new Error("Unknown-transfer clip is missing stream-level mastering display metadata.");
  }
  return clip("unknown-transfer", path, "unknown-transfer");
}

async function tryDolbyVision(sidecars, directory) {
  const encoders = toolText(sidecars.ffmpeg, "-encoders");
  if (!encoders.includes("libx265")) {
    return {
      reason: `${DOLBY_VISION_SKIP_REASON} This FFmpeg build also has no libx265 encoder.`,
    };
  }
  const path = join(directory, "dolby-vision.mp4");
  const result = spawnSync(sidecars.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    ...lavfiVideo(),
    "-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le",
    "-x265-params", [
      "log-level=error",
      "dolby-vision-profile=8.1",
      "vbv-maxrate=1000",
      "vbv-bufsize=1000",
      "master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)",
      "max-cll=1000,400",
    ].join(":"),
    "-color_primaries", "bt2020",
    "-color_trc", "smpte2084",
    "-colorspace", "bt2020nc",
    "-color_range", "tv",
    path,
  ], { encoding: "utf8", timeout: FFMPEG_TIMEOUT_MS });
  if (result.error || result.status !== 0) {
    await rm(path, { force: true });
    const detail = (result.stderr || result.error?.message || "FFmpeg failed").trim().split("\n").at(-1);
    return { reason: `${DOLBY_VISION_SKIP_REASON} The profile 8.1 attempt failed: ${detail}` };
  }
  const video = videoStream(probe(sidecars.ffprobe, path));
  const sideData = JSON.stringify(video.side_data_list ?? []).toLowerCase();
  if (sideData.includes("dovi") || sideData.includes("dolby vision")) {
    return { clip: clip("dolby-vision", path, "dolby-vision") };
  }
  await rm(path, { force: true });
  return { reason: DOLBY_VISION_SKIP_REASON };
}

export function insertStreamHdrMetadata(file) {
  const data = readFileSyncBuffer(file);
  const extra = masteringDisplayBoxes();
  const moov = findBox(data, 0, data.length, "moov");
  const trak = findVideoTrak(data, moov);
  const mdia = findBox(data, trak.offset + 8, trak.offset + trak.size, "mdia");
  const minf = findBox(data, mdia.offset + 8, mdia.offset + mdia.size, "minf");
  const stbl = findBox(data, minf.offset + 8, minf.offset + minf.size, "stbl");
  const stsd = findBox(data, stbl.offset + 8, stbl.offset + stbl.size, "stsd");
  const entry = stsd.offset + 16;
  const entryType = data.toString("ascii", entry + 4, entry + 8);
  if (entryType !== "hev1" && entryType !== "hvc1") {
    throw new Error(`Expected an HEVC sample entry, found ${entryType}.`);
  }
  const insertAt = entry + data.readUInt32BE(entry);
  const updated = Buffer.concat([data.subarray(0, insertAt), extra, data.subarray(insertAt)]);
  for (const box of [entry, stsd.offset, stbl.offset, minf.offset, mdia.offset, trak.offset, moov.offset]) {
    updated.writeUInt32BE(updated.readUInt32BE(box) + extra.length, box);
  }
  bumpChunkOffsets(updated, insertAt, extra.length);
  writeFileSyncBuffer(file, updated);
}

const CONTAINER_BOXES = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta", "mvex", "moof", "traf",
]);

function bumpChunkOffsets(data, insertAt, added) {
  walkBoxes(data, 0, data.length, (type, offset) => {
    if (type !== "stco" && type !== "co64") {
      return;
    }
    const count = data.readUInt32BE(offset + 12);
    const width = type === "stco" ? 4 : 8;
    let entry = offset + 16;
    for (let index = 0; index < count; index += 1) {
      if (width === 4) {
        const value = data.readUInt32BE(entry);
        if (value >= insertAt) {
          data.writeUInt32BE(value + added, entry);
        }
      } else {
        const value = data.readBigUInt64BE(entry);
        if (value >= BigInt(insertAt)) {
          data.writeBigUInt64BE(value + BigInt(added), entry);
        }
      }
      entry += width;
    }
  });
}

function walkBoxes(data, start, end, visit) {
  let offset = start;
  while (offset + 8 <= end) {
    const size = data.readUInt32BE(offset);
    if (size < 8 || offset + size > end) {
      break;
    }
    const type = data.toString("ascii", offset + 4, offset + 8);
    visit(type, offset, size);
    if (CONTAINER_BOXES.has(type)) {
      walkBoxes(data, offset + 8, offset + size, visit);
    }
    offset += size;
  }
}

function findVideoTrak(data, moov) {
  let offset = moov.offset + 8;
  const end = moov.offset + moov.size;
  while (offset + 8 <= end) {
    const size = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    if (type === "trak") {
      const mdia = findBox(data, offset + 8, offset + size, "mdia");
      const hdlr = findBox(data, mdia.offset + 8, mdia.offset + mdia.size, "hdlr");
      const handler = data.toString("ascii", hdlr.offset + 16, hdlr.offset + 20);
      if (handler === "vide") {
        return { offset, size };
      }
    }
    if (size < 8) break;
    offset += size;
  }
  throw new Error("The unknown-transfer clip has no video track.");
}

function findBox(data, start, end, type) {
  let offset = start;
  while (offset + 8 <= end) {
    const size = data.readUInt32BE(offset);
    const found = data.toString("ascii", offset + 4, offset + 8);
    if (found === type) {
      return { offset, size };
    }
    if (size < 8) break;
    offset += size;
  }
  throw new Error(`MP4 box ${type} was not found.`);
}

function readFileSyncBuffer(file) {
  return readFileSync(file);
}

function writeFileSyncBuffer(file, data) {
  writeFileSync(file, data);
}

function lavfiVideo() {
  return ["-f", "lavfi", "-i", `testsrc2=size=${FRAME_SIZE}:rate=${FRAME_RATE}:duration=${DURATION}`];
}

function lavfiAudio() {
  return ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${DURATION}`];
}

function clip(id, path, role) {
  return { id, path: resolve(path), role };
}

function probe(ffprobe, path) {
  const result = run(ffprobe, [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", path,
  ], { encode: false });
  return JSON.parse(result);
}

function probeFrames(ffprobe, path) {
  const result = run(ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-show_frames",
    "-show_entries", "frame=pts_time", "-of", "json", path,
  ], { encode: false });
  return JSON.parse(result).frames ?? [];
}

function ffmpegVersionLine(ffmpeg) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-version"], { encoding: "utf8", timeout: FFMPEG_TIMEOUT_MS });
  const line = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return line || "unknown";
}

function hasStaticHdrMetadata(sideData) {
  const text = (sideData ?? [])
    .map((entry) => entry.side_data_type ?? "")
    .join(" ")
    .toLowerCase();
  return text.includes("mastering display metadata") && text.includes("content light level metadata");
}

function firstFrameSideData(ffprobe, path) {
  const result = run(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-read_intervals", "%+#1",
    "-show_frames",
    "-show_entries", "frame=side_data_list",
    "-of", "json",
    path,
  ], { encode: false });
  const frames = JSON.parse(result).frames ?? [];
  return frames[0]?.side_data_list ?? [];
}

function videoStream(document) {
  const video = (document.streams ?? []).find((stream) => stream.codec_type === "video");
  if (!video) {
    throw new Error("FFprobe did not report a video stream.");
  }
  return video;
}

function toolText(ffmpeg, flag) {
  const result = spawnSync(ffmpeg, ["-hide_banner", flag], { encoding: "utf8" });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function run(binary, args, { encode = true } = {}) {
  const prefix = encode ? ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"] : ["-hide_banner"];
  const result = spawnSync(binary, [...prefix, ...args], { encoding: "utf8", timeout: FFMPEG_TIMEOUT_MS });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
    throw new Error(`${binary} failed: ${detail}`);
  }
  return result.stdout;
}

function isSpecifiedTransfer(value) {
  return Boolean(value) && !["unknown", "unspecified", "reserved"].includes(String(value).toLowerCase());
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}.`);
  }
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function parseOutputDirectory(argv) {
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--output") {
      output = argv[index + 1];
      if (!output) {
        throw new Error("--output requires a directory.");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}. Usage: node scripts/corpus/generate.mjs [--output DIR]`);
  }
  return { output };
}

async function main() {
  const options = parseOutputDirectory(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/corpus/generate.mjs [--output DIR]");
    console.log("Writes tiny synthetic clips and manifest.json. Media is not committed.");
    return;
  }
  let sidecars;
  try {
    sidecars = resolveSidecars();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  const output = options.output
    ? resolve(options.output)
    : await mkdtemp(join(tmpdir(), "vidra-corpus-"));
  const manifest = await generateCorpus(output, sidecars);
  for (const entry of manifest.unavailable) {
    console.error(`${entry.id}: ${entry.reason}`);
  }
  console.log(`Wrote ${manifest.clips.length} clips to ${output}`);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  await main();
}
