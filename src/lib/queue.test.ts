import { describe, expect, it } from "vitest";
import { defaultTrackSelection, emptyProgress, normalizedTrackSelection } from "./queue";
import type { EncodingSettings, MediaInfo } from "../types/media";
import { DEFAULT_ADVANCED_SETTINGS } from "../config/advanced";

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
