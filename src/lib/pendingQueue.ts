import { isEncodingSettings } from "../config/profiles";
import type {
  EncodeQueueItem,
  EncodingSettings,
  TrackSelection,
} from "../types/media";

export const PENDING_QUEUE_STORAGE_KEY = "vidra.pending-queue.v1";

export type PendingQueueEntry = {
  sourcePath: string;
  sourceName: string;
  settings: EncodingSettings;
  trackSelection: TrackSelection;
};

export type PendingQueueSnapshot = {
  version: 1;
  entries: PendingQueueEntry[];
};

export function pendingQueueEntries(items: EncodeQueueItem[]): PendingQueueEntry[] {
  return items.flatMap((item) => (
    item.status === "ready" || item.status === "queued"
      ? [{
          sourcePath: item.media.path,
          sourceName: item.media.name,
          settings: { ...item.settings },
          trackSelection: {
            audioStreamIndexes: [...item.trackSelection.audioStreamIndexes],
            subtitleStreamIndexes: [...item.trackSelection.subtitleStreamIndexes],
          },
        }]
      : []
  ));
}

export function parsePendingQueue(value: string | null): PendingQueueSnapshot | null {
  if (!value) return null;
  try {
    const document = JSON.parse(value) as unknown;
    if (!isRecord(document) || document.version !== 1 || !Array.isArray(document.entries)) {
      return null;
    }
    const entries = document.entries.flatMap((candidate) => (
      isPendingQueueEntry(candidate)
        ? [{
            sourcePath: candidate.sourcePath,
            sourceName: candidate.sourceName,
            settings: { ...candidate.settings },
            trackSelection: {
              audioStreamIndexes: [...candidate.trackSelection.audioStreamIndexes],
              subtitleStreamIndexes: [...candidate.trackSelection.subtitleStreamIndexes],
            },
          }]
        : []
    ));
    return entries.length > 0 ? { version: 1, entries } : null;
  } catch {
    return null;
  }
}

export function serializePendingQueue(entries: PendingQueueEntry[]): string {
  return JSON.stringify({ version: 1, entries });
}

export function loadPendingQueue(): PendingQueueSnapshot | null {
  try {
    return parsePendingQueue(localStorage.getItem(PENDING_QUEUE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePendingQueue(items: EncodeQueueItem[]): void {
  try {
    const entries = pendingQueueEntries(items);
    if (entries.length === 0) {
      localStorage.removeItem(PENDING_QUEUE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PENDING_QUEUE_STORAGE_KEY, serializePendingQueue(entries));
  } catch {
    // The live queue remains available when local storage is unavailable.
  }
}

export function clearPendingQueue(): void {
  try {
    localStorage.removeItem(PENDING_QUEUE_STORAGE_KEY);
  } catch {
    // The saved queue will be ignored for the rest of this session.
  }
}

function isPendingQueueEntry(value: unknown): value is PendingQueueEntry {
  return isRecord(value)
    && typeof value.sourcePath === "string"
    && value.sourcePath.length > 0
    && typeof value.sourceName === "string"
    && value.sourceName.length > 0
    && isEncodingSettings(value.settings)
    && isTrackSelection(value.trackSelection);
}

function isTrackSelection(value: unknown): value is TrackSelection {
  return isRecord(value)
    && isStreamIndexes(value.audioStreamIndexes)
    && isStreamIndexes(value.subtitleStreamIndexes);
}

function isStreamIndexes(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.every((candidate) => Number.isInteger(candidate) && Number(candidate) >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
