import type { EncodeQueueItem } from "../types/media";

export type ConversionActivity = {
  encodingCount: number;
  pausedCount: number;
  queuedCount: number;
  preparedCount: number;
  activeName: string | null;
  activePercent: number | null;
};

export function conversionActivity(items: EncodeQueueItem[]): ConversionActivity {
  const encoding = items.filter((item) => item.status === "encoding");
  const paused = items.filter((item) => item.status === "paused");
  const active = encoding[0] ?? paused[0] ?? null;
  return {
    encodingCount: encoding.length,
    pausedCount: paused.length,
    queuedCount: items.filter((item) => item.status === "queued").length,
    preparedCount: items.filter((item) => item.status === "ready").length,
    activeName: active?.media.name ?? null,
    activePercent: active && !active.progress.indeterminate
      ? Math.round(active.progress.percent)
      : null,
  };
}

export function isConversionInProgress(activity: ConversionActivity): boolean {
  return activity.encodingCount + activity.pausedCount + activity.queuedCount > 0;
}

/** User-facing sentence telling whether conversions survived an interface failure. */
export function conversionActivityMessage(activity: ConversionActivity): string {
  const pending = activity.encodingCount + activity.pausedCount + activity.queuedCount;
  const others = pending - 1;
  const othersSentence = others > 0
    ? ` ${others} other ${others === 1 ? "conversion is" : "conversions are"} still in the queue.`
    : "";
  const name = activity.activeName ? ` “${activity.activeName}”` : "";

  if (activity.encodingCount > 0) {
    const percent = activity.activePercent === null ? "" : ` at ${activity.activePercent}%`;
    return `A conversion is still running:${name} is encoding${percent} and keeps going while the interface recovers.${othersSentence}`;
  }
  if (activity.pausedCount > 0) {
    return `A conversion is paused, not cancelled:${name} is waiting to resume.${othersSentence}`;
  }
  if (activity.queuedCount > 0) {
    const queued = activity.queuedCount;
    return `No conversion is encoding. ${queued} ${queued === 1 ? "conversion is" : "conversions are"} still in the queue and kept their place.`;
  }
  if (activity.preparedCount > 0) {
    const prepared = activity.preparedCount;
    return `No conversion is running. ${prepared} prepared ${prepared === 1 ? "video is" : "videos are"} still in the queue.`;
  }
  return "No conversion is running, and nothing in the queue was affected.";
}

/** Counts only: diagnostic reports never carry media names or paths. */
export function conversionActivitySummary(activity: ConversionActivity): string {
  return [
    `Encoding: ${activity.encodingCount}`,
    `Paused: ${activity.pausedCount}`,
    `Queued: ${activity.queuedCount}`,
    `Prepared: ${activity.preparedCount}`,
  ].join("\n");
}
