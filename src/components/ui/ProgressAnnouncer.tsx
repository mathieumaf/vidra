import { useEffect, useRef, useState } from "react";
import { progressAnnouncement, type ProgressSnapshot } from "../../lib/a11y";
import { LiveRegion } from "./LiveRegion";

type ProgressAnnouncerProps = {
  active: boolean;
  paused: boolean;
  indeterminate: boolean;
  percent: number;
  label?: string;
};

/** Announces encoding start, pause, resume, and coarse progress. */
export function ProgressAnnouncer({
  active,
  paused,
  indeterminate,
  percent,
  label = "Encoding",
}: ProgressAnnouncerProps) {
  const previous = useRef<ProgressSnapshot | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const next = { active, paused, indeterminate, percent };
    const announcement = progressAnnouncement(previous.current, next, label);
    previous.current = next;
    if (announcement) setMessage(announcement);
  }, [active, paused, indeterminate, percent, label]);

  return <LiveRegion message={message} />;
}
