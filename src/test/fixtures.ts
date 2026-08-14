import { DEFAULT_ADVANCED_SETTINGS } from "../config/advanced";
import { emptyProgress } from "../lib/queue";
import type { EncodeQueueItem, MediaInfo } from "../types/media";

export function mediaFixture(name = "clip.mov"): MediaInfo {
  return {
    path: `/Users/casey/Movies/${name}`,
    name,
    durationSeconds: 7200,
    sizeBytes: 8_000_000_000,
    formatName: "mov,mp4",
    formatLongName: "QuickTime / MOV",
    video: null,
    audio: [],
    subtitles: [],
    chapterCount: 0,
    hasMetadata: false,
  };
}

export function queueItemFixture(overrides: Partial<EncodeQueueItem> = {}): EncodeQueueItem {
  const media = overrides.media ?? mediaFixture();
  return {
    clientId: `client-${media.name}`,
    jobId: null,
    media,
    settings: {
      quality: "balanced",
      container: "mp4",
      videoCodec: "h264",
      encodingSpeed: "efficient",
      audioMode: "auto",
      outputResolution: "source",
      ...DEFAULT_ADVANCED_SETTINGS,
    },
    trackSelection: { audioStreamIndexes: [], subtitleStreamIndexes: [] },
    outputPath: null,
    status: "ready",
    progress: emptyProgress(),
    error: null,
    diagnostic: null,
    ...overrides,
  };
}

export function encodingItemFixture(name = "clip.mov", percent = 42): EncodeQueueItem {
  const media = mediaFixture(name);
  return queueItemFixture({
    media,
    jobId: "job-1",
    status: "encoding",
    progress: { ...emptyProgress("job-1"), percent, outTimeSeconds: 3_000, etaSeconds: 4_200 },
  });
}
