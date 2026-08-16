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
      }],
    });
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
