import { join } from "@tauri-apps/api/path";
import type { EncodeProgress, EncodeQueueItem, MediaInfo, OutputContainer } from "../types/media";
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

export function createQueueItem(media: MediaInfo): EncodeQueueItem {
  return {
    clientId: crypto.randomUUID(),
    jobId: null,
    media,
    outputPath: null,
    status: "ready",
    progress: emptyProgress(),
    error: null,
  };
}

export async function batchOutputPaths(
  items: EncodeQueueItem[],
  directory: string,
  container: OutputContainer,
): Promise<string[]> {
  const nameCounts = new Map<string, number>();
  return Promise.all(items.map(async (item) => {
    const baseName = defaultOutputName(item.media.name, container);
    const count = (nameCounts.get(baseName.toLowerCase()) ?? 0) + 1;
    nameCounts.set(baseName.toLowerCase(), count);
    return join(directory, defaultOutputName(item.media.name, container, count));
  }));
}
