import type { SegmentTrim } from "../types/media";

const MILLISECOND = 0.001;

// Keep these sentences identical to src-tauri/src/ffmpeg/trim.rs.
export const INVALID_TIME = "Enter a valid start and end time.";
export const NEGATIVE_TIME = "Start and end times cannot be negative.";
export const END_NOT_AFTER_START = "The end time must be later than the start time.";
export const START_AFTER_VIDEO = "The start time is past the end of the video.";
export const END_AFTER_VIDEO = "The end time is past the end of the video.";
export const UNKNOWN_DURATION = "This video's duration is unknown, so a segment cannot be selected.";

export type TrimAssessment =
  | { ok: true; trim: SegmentTrim | null }
  | { ok: false; message: string };

export function durationKnown(durationSeconds: number): boolean {
  return Number.isFinite(durationSeconds) && durationSeconds > 0;
}

export function assessTrim(
  trim: SegmentTrim | null,
  durationSeconds: number,
): TrimAssessment {
  if (!trim) return { ok: true, trim: null };
  if (!Number.isFinite(trim.startSeconds) || !Number.isFinite(trim.endSeconds)) {
    return { ok: false, message: INVALID_TIME };
  }
  if (trim.startSeconds < -MILLISECOND / 2 || trim.endSeconds < -MILLISECOND / 2) {
    return { ok: false, message: NEGATIVE_TIME };
  }
  if (!durationKnown(durationSeconds)) {
    return { ok: false, message: UNKNOWN_DURATION };
  }

  const start = Math.max(0, trim.startSeconds);
  const end = Math.max(0, trim.endSeconds);
  if (start > durationSeconds + MILLISECOND / 2) {
    return { ok: false, message: START_AFTER_VIDEO };
  }
  if (end > durationSeconds + MILLISECOND / 2) {
    return { ok: false, message: END_AFTER_VIDEO };
  }

  const clampedStart = Math.min(start, durationSeconds);
  const clampedEnd = Math.min(end, durationSeconds);
  if (clampedEnd - clampedStart < MILLISECOND / 2) {
    return { ok: false, message: END_NOT_AFTER_START };
  }
  if (
    clampedStart <= MILLISECOND / 2
    && durationSeconds - clampedEnd <= MILLISECOND / 2
  ) {
    return { ok: true, trim: null };
  }

  return {
    ok: true,
    trim: { startSeconds: clampedStart, endSeconds: clampedEnd },
  };
}

export function parseTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  if (!/^(?:\d+:){0,2}\d+(?:\.\d+)?$/.test(body)) return null;

  const parts = body.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;

  let seconds: number;
  if (parts.length === 3) {
    if (parts[1] >= 60 || parts[2] >= 60) return null;
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    if (parts[1] >= 60) return null;
    seconds = parts[0] * 60 + parts[1];
  } else {
    seconds = parts[0];
  }

  return negative ? -seconds : seconds;
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalMilliseconds = Math.round(seconds * 1000);
  const fraction = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const remainder = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const clock = hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
  if (fraction === 0) return clock;
  const fractionText = fraction.toString().padStart(3, "0").replace(/0+$/, "");
  return `${clock}.${fractionText}`;
}

export function trimSummary(trim: SegmentTrim | null): string | null {
  if (!trim) return null;
  return `Trimmed ${formatTimestamp(trim.startSeconds)}–${formatTimestamp(trim.endSeconds)}`;
}
