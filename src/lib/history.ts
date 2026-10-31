import { videoCodecLabel } from "../config/encoding";
import { qualityLevel } from "../config/quality";
import { outputResolutionLabel } from "../config/resolution";
import { outputFrameRateLabel } from "../config/advanced";
import type { HistoryEntry, SegmentTrim } from "../types/media";
import { formatBytes } from "./format";
import { formatTimestamp } from "./trim";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function historyDate(finishedAtMs: number): string {
  return dateFormatter.format(new Date(finishedAtMs));
}

export function historySummary(entry: HistoryEntry): string {
  const details = [
    entry.settings.container.toUpperCase(),
    entry.settings.videoCodec === "copy"
      ? "Original video"
      : videoCodecLabel(entry.settings.videoCodec),
    qualityLevel(entry.settings.quality).label,
    outputResolutionLabel(entry.settings.outputResolution),
  ];
  if (entry.settings.outputFrameRate !== "source") {
    details.push(outputFrameRateLabel(entry.settings.outputFrameRate));
  }
  if (entry.outputSizeBytes !== null) details.push(formatBytes(entry.outputSizeBytes));
  const segment = historySegment(entry);
  if (segment) details.push(trimSummaryText(segment));
  details.push(historyDate(entry.finishedAtMs));
  return details.join(" · ");
}

function historySegment(entry: HistoryEntry): SegmentTrim | null {
  if (
    entry.trimStartSeconds === null
    || entry.trimEndSeconds === null
    || !Number.isFinite(entry.trimStartSeconds)
    || !Number.isFinite(entry.trimEndSeconds)
    || entry.trimEndSeconds <= entry.trimStartSeconds
  ) {
    return null;
  }
  return { startSeconds: entry.trimStartSeconds, endSeconds: entry.trimEndSeconds };
}

function trimSummaryText(trim: SegmentTrim): string {
  const length = trim.endSeconds - trim.startSeconds;
  return `Trimmed ${formatTimestamp(trim.startSeconds)}–${formatTimestamp(trim.endSeconds)} (${formatTimestamp(length)})`;
}

export function historyDescription(entry: HistoryEntry): string {
  if (entry.status === "completed") {
    return entry.error ? `${entry.outputPath} — ${entry.error}` : entry.outputPath;
  }
  if (entry.status === "failed") return entry.error ?? "The conversion could not be completed.";
  return "The conversion was cancelled before an output was created.";
}
