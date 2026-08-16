import { describe, expect, it, vi } from "vitest";
import {
  batchOutputPaths,
  createQueueItem,
  defaultTrackSelection,
  emptyProgress,
  normalizedTrackSelection,
} from "./queue";
import type { EncodingSettings, MediaInfo } from "../types/media";
import { DEFAULT_ADVANCED_SETTINGS } from "../config/advanced";

vi.mock("@tauri-apps/api/path", () => ({
  join: (...segments: string[]) => Promise.resolve(segments.join("/")),
}));

const settings: EncodingSettings = {
  quality: "balanced",
  container: "mkv",
  videoCodec: "h264",
  encodingSpeed: "efficient",
  audioMode: "auto",
  outputResolution: "source",
  ...DEFAULT_ADVANCED_SETTINGS,
};

const media: MediaInfo = {
  path: "/tmp/source.mkv",
  name: "source.mkv",
  durationSeconds: 10,
  sizeBytes: 100,
  formatName: "matroska",
  formatLongName: "Matroska",
  video: null,
  audio: [
    { index: 1, codec: "aac", channels: 2, sampleRate: 48_000, bitRate: 128_000, language: "en", title: null },
    { index: 3, codec: "aac", channels: 2, sampleRate: 48_000, bitRate: 128_000, language: "fr", title: null },
  ],
  subtitles: [
    { index: 4, codec: "subrip", language: "en", title: null, isDefault: true, isForced: false },
  ],
  chapterCount: 0,
  hasMetadata: false,
};

describe("queue helpers", () => {
  it("starts progress from a stable empty state", () => {
    expect(emptyProgress("job-1")).toEqual({
      jobId: "job-1",
      percent: 0,
      indeterminate: false,
      elapsedSeconds: 0,
      outTimeSeconds: 0,
      speed: null,
      etaSeconds: null,
      frame: null,
    });
  });

  it("selects every compatible track by default", () => {
    expect(defaultTrackSelection(media, settings)).toEqual({
      audioStreamIndexes: [1, 3],
      subtitleStreamIndexes: [4],
    });
  });

  it("filters stale or forged stream indexes", () => {
    expect(normalizedTrackSelection(media, {
      audioStreamIndexes: [3, 99],
      subtitleStreamIndexes: [4, 88],
    })).toEqual({
      audioStreamIndexes: [3],
      subtitleStreamIndexes: [4],
    });
  });
});

describe("batch output names", () => {
  const item = () => createQueueItem(media, settings);

  it("keeps the preferred name when the destination folder is free", async () => {
    expect(await batchOutputPaths([item()], "/videos", [], ["unrelated.mkv"])).toEqual({
      paths: ["/videos/source-vidra.mkv"],
      renamedCount: 0,
    });
  });

  it("numbers an output that would replace an existing destination file", async () => {
    expect(await batchOutputPaths([item()], "/videos", [], ["source-vidra.mkv"])).toEqual({
      paths: ["/videos/source-vidra-2.mkv"],
      renamedCount: 1,
    });
  });

  it("keeps every result of the same batch converted twice into one folder", async () => {
    const first = await batchOutputPaths([item(), item()], "/videos", [], []);
    expect(first).toEqual({
      paths: ["/videos/source-vidra.mkv", "/videos/source-vidra-2.mkv"],
      renamedCount: 1,
    });

    const second = await batchOutputPaths(
      [item(), item()],
      "/videos",
      [],
      first.paths.map((path) => path.slice("/videos/".length)),
    );
    expect(second).toEqual({
      paths: ["/videos/source-vidra-3.mkv", "/videos/source-vidra-4.mkv"],
      renamedCount: 2,
    });
  });

  it("matches existing destination files regardless of letter case", async () => {
    expect(await batchOutputPaths([item()], "/videos", [], ["SOURCE-VIDRA.MKV"])).toEqual({
      paths: ["/videos/source-vidra-2.mkv"],
      renamedCount: 1,
    });
  });

  it("avoids both existing files and outputs already reserved by the queue", async () => {
    expect(await batchOutputPaths(
      [item()],
      "/videos",
      ["/videos/source-vidra-2.mkv"],
      ["source-vidra.mkv"],
    )).toEqual({
      paths: ["/videos/source-vidra-3.mkv"],
      renamedCount: 1,
    });
  });
});
