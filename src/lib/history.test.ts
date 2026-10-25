import { describe, expect, it } from "vitest";
import { historyDescription } from "./history";
import type { HistoryEntry } from "../types/media";

const entry = (status: HistoryEntry["status"], error: string | null): HistoryEntry => ({
  id: "conversion-1",
  sourcePath: "/videos/holiday.mov",
  sourceName: "holiday.mov",
  outputPath: "/videos/holiday-vidra-2.mp4",
  status,
  startedAtMs: 1,
  finishedAtMs: 2,
  mediaDurationSeconds: 10,
  sourceSizeBytes: 100,
  outputSizeBytes: 80,
  settings: {
    quality: "balanced",
    container: "mp4",
    videoCodec: "h264",
    encodingSpeed: "efficient",
    audioMode: "auto",
    outputResolution: "source",
    outputFrameRate: "source",
    qualityTuning: 0,
    audioBitrate: "auto",
    audioChannels: "source",
    audioTrackMode: "all",
    preserveSubtitles: true,
    preserveMetadata: true,
    preserveChapters: true,
  },
  error,
  diagnostic: null,
});

describe("historyDescription", () => {
  it("reports where a finished video was saved when the requested name was taken", () => {
    expect(historyDescription(entry(
      "completed",
      "The requested name was already in use, so the finished video was saved as holiday-vidra-2.mp4.",
    ))).toContain("/videos/holiday-vidra-2.mp4");
  });

  it("keeps a completed path when the requested name was used", () => {
    expect(historyDescription(entry("completed", null))).toBe("/videos/holiday-vidra-2.mp4");
  });
});
