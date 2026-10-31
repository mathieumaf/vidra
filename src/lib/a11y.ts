/** Enabled option reached by a radio-group arrow, Home, or End key. */
export function nextRadioValue<T extends string>(
  enabledIds: readonly T[],
  current: T,
  key: string,
): T | null {
  if (enabledIds.length === 0) return null;
  const index = enabledIds.indexOf(current);
  const last = enabledIds.length - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return enabledIds[index < 0 ? 0 : (index + 1) % enabledIds.length];
    case "ArrowLeft":
    case "ArrowUp":
      return enabledIds[index <= 0 ? last : index - 1];
    case "Home":
      return enabledIds[0];
    case "End":
      return enabledIds[last];
    default:
      return null;
  }
}

export type ProgressSnapshot = {
  active: boolean;
  paused: boolean;
  indeterminate: boolean;
  percent: number;
};

/**
 * Short status phrase for an encoding progress change.
 * Percent is announced on 25-point boundaries so a live region does not
 * speak every progress tick.
 */
export function progressAnnouncement(
  previous: ProgressSnapshot | null,
  next: ProgressSnapshot,
  label = "Encoding",
): string | null {
  if (!next.active) return null;
  if (!previous?.active) {
    if (next.paused) return `${label} paused`;
    if (next.indeterminate || Math.round(next.percent) <= 0) return `${label} started`;
    return `${label} in progress, ${Math.round(next.percent)} percent`;
  }
  if (next.paused && !previous.paused) return `${label} paused`;
  if (!next.paused && previous.paused) return `${label} resumed`;
  if (next.paused || next.indeterminate) return null;
  const bucket = progressBucket(next.percent);
  const previousBucket = progressBucket(previous.percent);
  if (bucket !== previousBucket && bucket > 0 && bucket < 100) {
    return `${label} ${bucket} percent`;
  }
  return null;
}

export type QueueAnnouncementItem = {
  id: string;
  name: string;
  status: string;
  /** Determinate percent while encoding, otherwise null. */
  percent: number | null;
};

export type QueueAnnouncementState = {
  name: string;
  status: string;
  bucket: number | null;
};

/** Differences a queue live region should speak after a state update. */
export function queueAnnouncement(
  previous: ReadonlyMap<string, QueueAnnouncementState>,
  items: readonly QueueAnnouncementItem[],
  statusLabels: Readonly<Record<string, string>>,
): string | null {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    seen.add(item.id);
    const before = previous.get(item.id);
    const bucket = item.percent === null ? null : progressBucket(item.percent);
    if (!before) {
      lines.push(`${item.name} added`);
      continue;
    }
    if (before.status !== item.status) {
      lines.push(`${item.name}, ${statusLabels[item.status] ?? item.status}`);
      continue;
    }
    if (bucket !== null && bucket !== before.bucket && bucket > 0 && bucket < 100) {
      lines.push(`${item.name}, ${bucket} percent`);
    }
  }
  for (const [id, before] of previous) {
    if (!seen.has(id)) lines.push(`${before.name} removed`);
  }
  return lines.length > 0 ? lines.join(". ") : null;
}

export function queueAnnouncementState(
  items: readonly QueueAnnouncementItem[],
): Map<string, QueueAnnouncementState> {
  return new Map(items.map((item) => [item.id, {
    name: item.name,
    status: item.status,
    bucket: item.percent === null ? null : progressBucket(item.percent),
  }]));
}

function progressBucket(percent: number): number {
  return Math.floor(percent / 25) * 25;
}

/** Focusable controls inside a dialog, in tab order. */
export function focusableElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.closest("[inert]")) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.tabIndex < 0) return false;
    return true;
  });
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");
