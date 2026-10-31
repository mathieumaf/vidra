import { useEffect, useRef, useState } from "react";
import {
  queueAnnouncement,
  queueAnnouncementState,
  type QueueAnnouncementItem,
  type QueueAnnouncementState,
} from "../lib/a11y";

/** Speaks queue additions, removals, status changes, and coarse progress. */
export function useQueueAnnouncements(
  items: readonly QueueAnnouncementItem[],
  statusLabels: Readonly<Record<string, string>>,
): string {
  const previous = useRef<Map<string, QueueAnnouncementState> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const prior = previous.current;
    const next = queueAnnouncementState(items);
    previous.current = next;
    if (!prior) return;
    const announcement = queueAnnouncement(prior, items, statusLabels);
    if (announcement) setMessage(announcement);
  }, [items, statusLabels]);

  return message;
}
