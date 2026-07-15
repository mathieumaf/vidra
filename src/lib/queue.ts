import { join } from "@tauri-apps/api/path";
import type {
  EncodingSettings,
  EncodeProgress,
  EncodeQueueItem,
  MediaInfo,
  TrackSelection,
} from "../types/media";
import { defaultOutputName } from "./format";

export const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function emptyProgress(jobId = ""): EncodeProgress {
  return {
    jobId,
    percent: 0,
    outTimeSeconds: 0,
    speed: null,
    etaSeconds: null,
    frame: null,
  };
}

export function createQueueItem(media: MediaInfo, settings: EncodingSettings): EncodeQueueItem {
  return {
    clientId: crypto.randomUUID(),
    jobId: null,
    media,
    settings: { ...settings },
    trackSelection: defaultTrackSelection(media, settings),
    outputPath: null,
    status: "ready",
    progress: emptyProgress(),
    error: null,
  };
}

export function defaultTrackSelection(
  media: MediaInfo,
  settings: EncodingSettings,
): TrackSelection {
  return {
    audioStreamIndexes: settings.audioTrackMode === "first"
      ? media.audio.slice(0, 1).map((stream) => stream.index)
      : media.audio.map((stream) => stream.index),
    subtitleStreamIndexes: settings.preserveSubtitles
      ? media.subtitles.map((stream) => stream.index)
      : [],
  };
}

export function normalizedTrackSelection(
  media: MediaInfo,
  selection: TrackSelection,
): TrackSelection {
  const requestedAudio = new Set(selection.audioStreamIndexes);
  const requestedSubtitles = new Set(selection.subtitleStreamIndexes);
  return {
    audioStreamIndexes: media.audio
      .filter((stream) => requestedAudio.has(stream.index))
      .map((stream) => stream.index),
    subtitleStreamIndexes: media.subtitles
      .filter((stream) => requestedSubtitles.has(stream.index))
      .map((stream) => stream.index),
  };
}

export async function batchOutputPaths(
  items: EncodeQueueItem[],
  directory: string,
  reservedPaths: string[] = [],
): Promise<string[]> {
  const usedPaths = new Set(reservedPaths.map((path) => path.toLowerCase()));
  const paths: string[] = [];

  for (const item of items) {
    let suffix = 1;
    let outputPath = await join(
      directory,
      defaultOutputName(item.media.name, item.settings.container, suffix),
    );
    while (usedPaths.has(outputPath.toLowerCase())) {
      suffix += 1;
      outputPath = await join(
        directory,
        defaultOutputName(item.media.name, item.settings.container, suffix),
      );
    }
    usedPaths.add(outputPath.toLowerCase());
    paths.push(outputPath);
  }

  return paths;
}
