import { videoCodecLabel } from "../config/encoding";
import { qualityLevel } from "../config/quality";
import type { HistoryEntry } from "../types/media";
import { formatBytes } from "./format";

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
  ];
  if (entry.outputSizeBytes !== null) details.push(formatBytes(entry.outputSizeBytes));
  details.push(historyDate(entry.finishedAtMs));
  return details.join(" · ");
}

export function historyDescription(entry: HistoryEntry): string {
  if (entry.status === "completed") return entry.outputPath;
  if (entry.status === "failed") return entry.error ?? "The conversion could not be completed.";
  return "The conversion was cancelled before an output was created.";
}
