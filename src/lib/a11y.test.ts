import { describe, expect, it } from "vitest";
import {
  nextRadioValue,
  progressAnnouncement,
  queueAnnouncement,
  type ProgressSnapshot,
} from "./a11y";

const encoding: ProgressSnapshot = {
  active: true,
  paused: false,
  indeterminate: false,
  percent: 0,
};

describe("radio group keyboard movement", () => {
  const ids = ["mp4", "mkv"] as const;

  it("moves between enabled options and wraps", () => {
    expect(nextRadioValue(ids, "mp4", "ArrowRight")).toBe("mkv");
    expect(nextRadioValue(ids, "mkv", "ArrowRight")).toBe("mp4");
    expect(nextRadioValue(ids, "mkv", "ArrowLeft")).toBe("mp4");
    expect(nextRadioValue(ids, "mp4", "Home")).toBe("mp4");
    expect(nextRadioValue(ids, "mp4", "End")).toBe("mkv");
    expect(nextRadioValue(ids, "mp4", "Enter")).toBeNull();
    expect(nextRadioValue([], "mp4", "ArrowRight")).toBeNull();
  });
});

describe("encoding progress announcements", () => {
  it("announces start, pause, resume, and quarter progress without every tick", () => {
    expect(progressAnnouncement(null, encoding)).toBe("Encoding started");
    expect(progressAnnouncement(encoding, { ...encoding, percent: 10 })).toBeNull();
    expect(progressAnnouncement(encoding, { ...encoding, percent: 25 })).toBe("Encoding 25 percent");
    expect(progressAnnouncement(
      { ...encoding, percent: 25 },
      { ...encoding, percent: 49 },
    )).toBeNull();
    expect(progressAnnouncement(encoding, { ...encoding, paused: true })).toBe("Encoding paused");
    expect(progressAnnouncement(
      { ...encoding, paused: true, percent: 40 },
      { ...encoding, percent: 40 },
    )).toBe("Encoding resumed");
    expect(progressAnnouncement(encoding, { ...encoding, active: false, percent: 100 })).toBeNull();
  });

  it("does not announce a percent while progress is indeterminate", () => {
    const indeterminate = { ...encoding, indeterminate: true, percent: 0 };
    expect(progressAnnouncement(null, indeterminate)).toBe("Encoding started");
    expect(progressAnnouncement(indeterminate, { ...indeterminate, percent: 50 })).toBeNull();
  });
});

describe("queue announcements", () => {
  const labels = { ready: "Ready", encoding: "Encoding", completed: "Complete" };

  it("speaks additions, status changes, coarse progress, and removals", () => {
    const previous = new Map([
      ["a", { name: "holiday.mov", status: "ready", bucket: null }],
      ["b", { name: "interview.mkv", status: "encoding", bucket: 25 }],
    ]);
    expect(queueAnnouncement(previous, [
      { id: "a", name: "holiday.mov", status: "encoding", percent: 0 },
      { id: "b", name: "interview.mkv", status: "encoding", percent: 30 },
      { id: "c", name: "notes.mp4", status: "ready", percent: null },
    ], labels)).toBe("holiday.mov, Encoding. notes.mp4 added");

    expect(queueAnnouncement(previous, [
      { id: "b", name: "interview.mkv", status: "encoding", percent: 50 },
    ], labels)).toBe("interview.mkv, 50 percent. holiday.mov removed");
  });
});
