import { useEffect, useRef, useState } from "react";
import { progressAnnouncement, type ProgressSnapshot } from "../../lib/a11y";
import { LiveRegion } from "./LiveRegion";

type ProgressAnnouncerProps = {
  active: boolean;
  paused: boolean;
  indeterminate: boolean;
  percent: number;
  label?: string;
  /** Outcome to speak once encoding stops, such as completion or cancellation. */
  outcome?: string | null;
};

/**
 * Announces encoding start, pause, resume, coarse progress, and the outcome.
 * One live region stays mounted for all of them: VoiceOver often ignores a region
 * that is inserted together with its text, such as a new completion message.
 */
export function ProgressAnnouncer({
  active,
  paused,
  indeterminate,
  percent,
  label = "Encoding",
  outcome = null,
}: ProgressAnnouncerProps) {
  const previous = useRef<ProgressSnapshot | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const next = { active, paused, indeterminate, percent };
    const announcement = progressAnnouncement(previous.current, next, label);
    previous.current = next;
    if (announcement) setMessage(announcement);
  }, [active, paused, indeterminate, percent, label]);

  useEffect(() => {
    if (!active && outcome) setMessage(outcome);
  }, [active, outcome]);

  return <LiveRegion message={message} />;
}
