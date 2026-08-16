import { describe, expect, it } from "vitest";
import {
  conversionActivity,
  conversionActivityMessage,
  conversionActivitySummary,
  isConversionInProgress,
} from "./conversionActivity";
import { encodingItemFixture, mediaFixture, queueItemFixture } from "../test/fixtures";

describe("conversionActivity", () => {
  it("counts the queue by status and names the running conversion", () => {
    const activity = conversionActivity([
      encodingItemFixture("holiday.mov", 41.6),
      queueItemFixture({ media: mediaFixture("interview.mkv"), status: "queued" }),
      queueItemFixture({ media: mediaFixture("timelapse.mp4"), status: "paused" }),
      queueItemFixture({ media: mediaFixture("draft.mp4"), status: "ready" }),
      queueItemFixture({ media: mediaFixture("done.mp4"), status: "completed" }),
    ]);

    expect(activity).toEqual({
      encodingCount: 1,
      pausedCount: 1,
      queuedCount: 1,
      preparedCount: 1,
      activeName: "holiday.mov",
      activePercent: 42,
    });
    expect(isConversionInProgress(activity)).toBe(true);
  });

  it("reports no work in progress for an empty or finished queue", () => {
    const activity = conversionActivity([queueItemFixture({ status: "completed" })]);

    expect(isConversionInProgress(activity)).toBe(false);
    expect(isConversionInProgress(conversionActivity([]))).toBe(false);
  });

  it("tells the user a conversion survives the interface failure", () => {
    const message = conversionActivityMessage(conversionActivity([
      encodingItemFixture("holiday.mov", 42),
      queueItemFixture({ media: mediaFixture("interview.mkv"), status: "queued" }),
    ]));

    expect(message).toContain("A conversion is still running");
    expect(message).toContain("holiday.mov");
    expect(message).toContain("42%");
    expect(message).toContain("1 other conversion is still in the queue");
  });

  it("does not report a fake percentage for indeterminate progress", () => {
    const item = encodingItemFixture("live-stream.ts", 0);
    item.progress.indeterminate = true;

    const activity = conversionActivity([item]);
    const message = conversionActivityMessage(activity);

    expect(activity.activePercent).toBeNull();
    expect(message).toContain("live-stream.ts");
    expect(message).not.toContain("0%");
  });

  it("explains a paused, queued, prepared, and empty queue differently", () => {
    const paused = conversionActivityMessage(conversionActivity([
      queueItemFixture({ media: mediaFixture("paused.mov"), status: "paused" }),
    ]));
    const queued = conversionActivityMessage(conversionActivity([
      queueItemFixture({ status: "queued" }),
      queueItemFixture({ media: mediaFixture("second.mov"), status: "queued" }),
    ]));
    const prepared = conversionActivityMessage(conversionActivity([queueItemFixture()]));
    const empty = conversionActivityMessage(conversionActivity([]));

    expect(paused).toContain("paused, not cancelled");
    expect(paused).toContain("paused.mov");
    expect(queued).toContain("2 conversions are still in the queue");
    expect(prepared).toContain("1 prepared video is still in the queue");
    expect(empty).toContain("No conversion is running");
  });

  it("keeps media names out of the report summary", () => {
    const summary = conversionActivitySummary(conversionActivity([
      encodingItemFixture("private-wedding.mov"),
    ]));

    expect(summary).toContain("Encoding: 1");
    expect(summary).toContain("Queued: 0");
    expect(summary).not.toContain("private-wedding");
  });
});
