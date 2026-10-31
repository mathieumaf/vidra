import { describe, expect, it } from "vitest";
import {
  assessTrim,
  END_AFTER_VIDEO,
  END_NOT_AFTER_START,
  formatTimestamp,
  INVALID_TIME,
  NEGATIVE_TIME,
  parseTimestamp,
  START_AFTER_VIDEO,
  trimSummary,
  UNKNOWN_DURATION,
} from "./trim";

describe("segment bounds", () => {
  it("rejects ranges that cannot be cut", () => {
    expect(assessTrim({ startSeconds: Number.NaN, endSeconds: 1 }, 10)).toEqual({
      ok: false,
      message: INVALID_TIME,
    });
    expect(assessTrim({ startSeconds: -1, endSeconds: 4 }, 10)).toEqual({
      ok: false,
      message: NEGATIVE_TIME,
    });
    expect(assessTrim({ startSeconds: 4, endSeconds: 4 }, 10)).toEqual({
      ok: false,
      message: END_NOT_AFTER_START,
    });
    expect(assessTrim({ startSeconds: 6, endSeconds: 4 }, 10)).toEqual({
      ok: false,
      message: END_NOT_AFTER_START,
    });
    expect(assessTrim({ startSeconds: 11, endSeconds: 12 }, 10)).toEqual({
      ok: false,
      message: START_AFTER_VIDEO,
    });
    expect(assessTrim({ startSeconds: 1, endSeconds: 10.01 }, 10)).toEqual({
      ok: false,
      message: END_AFTER_VIDEO,
    });
    expect(assessTrim({ startSeconds: 1, endSeconds: 2 }, 0)).toEqual({
      ok: false,
      message: UNKNOWN_DURATION,
    });
  });

  it("keeps a partial segment and treats the whole video as no trim", () => {
    expect(assessTrim(null, 10)).toEqual({ ok: true, trim: null });
    expect(assessTrim({ startSeconds: 1.25, endSeconds: 4.5 }, 10)).toEqual({
      ok: true,
      trim: { startSeconds: 1.25, endSeconds: 4.5 },
    });
    expect(assessTrim({ startSeconds: 0, endSeconds: 10 }, 10)).toEqual({
      ok: true,
      trim: null,
    });
  });

  it("parses and displays clock times", () => {
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("1:30")).toBe(90);
    expect(parseTimestamp("1:02:03.5")).toBe(3723.5);
    expect(parseTimestamp("1:60")).toBeNull();
    expect(parseTimestamp("-2")).toBe(-2);
    expect(formatTimestamp(90)).toBe("1:30");
    expect(formatTimestamp(1.5)).toBe("0:01.5");
    expect(formatTimestamp(3723.25)).toBe("1:02:03.25");
    expect(trimSummary({ startSeconds: 10, endSeconds: 70 })).toBe("Trimmed 0:10–1:10");
    expect(trimSummary(null)).toBeNull();
  });
});
