import { useEffect, useRef } from "react";
import { segmentKeyframe } from "../services/encoding";
import type { EncodeQueueItem } from "../types/media";

const DEBOUNCE_MS = 200;

export type KeyframeTarget = {
  clientId: string;
  path: string;
  startSeconds: number;
};

/**
 * Looks up the keyframe Original video will actually start on.
 *
 * The lookup key is the source and the chosen start. Marking a row as
 * "checking" must not cancel the request that just started.
 */
export function useKeyframeLookup(
  items: EncodeQueueItem[],
  onChecking: (target: KeyframeTarget) => void,
  onResult: (
    target: KeyframeTarget,
    result: { status: "ready"; seconds: number } | { status: "failed" },
  ) => void,
): void {
  const onCheckingRef = useRef(onChecking);
  const onResultRef = useRef(onResult);
  onCheckingRef.current = onChecking;
  onResultRef.current = onResult;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const lookupKey = items
    .filter((item) => (
      item.status === "ready"
      && item.settings.videoCodec === "copy"
      && item.trim !== null
    ))
    .map((item) => `${item.clientId}\u0000${item.media.path}\u0000${item.trim?.startSeconds}`)
    .join("\n");

  useEffect(() => {
    const targets = itemsRef.current.flatMap((item): KeyframeTarget[] => {
      if (
        item.status !== "ready"
        || item.settings.videoCodec !== "copy"
        || item.trim === null
        || item.copyStartStatus !== "unknown"
      ) {
        return [];
      }
      return [{
        clientId: item.clientId,
        path: item.media.path,
        startSeconds: item.trim.startSeconds,
      }];
    });
    if (targets.length === 0) return undefined;

    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      for (const target of targets) onCheckingRef.current(target);
      void (async () => {
        for (const target of targets) {
          if (!active) return;
          try {
            const seconds = await segmentKeyframe(target.path, target.startSeconds);
            if (active) onResultRef.current(target, { status: "ready", seconds });
          } catch {
            if (active) onResultRef.current(target, { status: "failed" });
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [lookupKey]);
}
