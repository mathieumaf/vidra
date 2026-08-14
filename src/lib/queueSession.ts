import type { EncodeQueueItem } from "../types/media";

/**
 * Last known queue contents, kept outside React so that recovering from an
 * interface failure remounts the application without losing the queue. Rust
 * owns the conversions themselves, so this only mirrors what the queue shows.
 */
let sessionItems: EncodeQueueItem[] = [];

export function rememberQueueItems(items: EncodeQueueItem[]): void {
  sessionItems = items;
}

export function rememberedQueueItems(): EncodeQueueItem[] {
  return sessionItems;
}

export function clearQueueSession(): void {
  sessionItems = [];
}
