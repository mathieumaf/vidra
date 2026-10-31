import { describe, expect, it } from "vitest";
import { queueItemFixture } from "../test/fixtures";
import {
  parsePendingQueue,
  pendingQueueEntries,
  serializePendingQueue,
} from "./pendingQueue";

describe("pending queue persistence", () => {
  it("round-trips pending videos with their settings and track selections", () => {
    const item = queueItemFixture({
      status: "queued",
      settings: {
        ...queueItemFixture().settings,
        quality: "high-quality",
        container: "mkv",
        videoCodec: "h265",
      },
      trackSelection: {
        audioStreamIndexes: [1, 2],
        subtitleStreamIndexes: [4],
      },
    });
    const entries = pendingQueueEntries([item]);

    expect(parsePendingQueue(serializePendingQueue(entries))).toEqual({
      version: 1,
      entries: [{
        sourcePath: item.media.path,
        sourceName: item.media.name,
        settings: item.settings,
        trackSelection: item.trackSelection,
        trim: null,
      }],
    });
  });

  it("keeps a segment across a restart and still reads queues saved before trimming existed", () => {
    const item = queueItemFixture({
      status: "queued",
      trim: { startSeconds: 5, endSeconds: 20 },
    });
    const saved = JSON.parse(serializePendingQueue(pendingQueueEntries([item]))) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(parsePendingQueue(JSON.stringify(saved))?.entries[0].trim).toEqual({
      startSeconds: 5,
      endSeconds: 20,
    });

    delete saved.entries[0].trim;
    expect(parsePendingQueue(JSON.stringify(saved))?.entries[0].trim).toBeNull();
  });

  it("keeps waiting work but never persists interrupted or finished jobs", () => {
    const statuses = [
      "ready",
      "queued",
      "encoding",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ] as const;
    const items = statuses.map((status) => queueItemFixture({
      clientId: status,
      status,
    }));

    expect(pendingQueueEntries(items).map((entry) => entry.sourceName)).toEqual([
      "clip.mov",
      "clip.mov",
    ]);
  });

  it("ignores malformed, empty, and unsupported saved documents", () => {
    expect(parsePendingQueue("not json")).toBeNull();
    expect(parsePendingQueue(JSON.stringify({ version: 2, entries: [] }))).toBeNull();
    expect(parsePendingQueue(JSON.stringify({ version: 1, entries: [] }))).toBeNull();
    expect(parsePendingQueue(JSON.stringify({
      version: 1,
      entries: [{ sourcePath: "/tmp/missing.mov", sourceName: "missing.mov" }],
    }))).toBeNull();

    const validEntry = pendingQueueEntries([queueItemFixture()])[0];
    expect(parsePendingQueue(JSON.stringify({
      version: 1,
      entries: [{
        ...validEntry,
        settings: { ...validEntry.settings, outputFrameRate: 30 },
      }],
    }))).toBeNull();
  });
});
