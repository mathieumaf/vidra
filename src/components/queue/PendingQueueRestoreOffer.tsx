import { useEffect, useRef } from "react";
import type { PendingQueueSnapshot } from "../../lib/pendingQueue";
import { useModalDialog } from "../../hooks/useModalDialog";
import { Icon } from "../ui/Icon";

type PendingQueueRestoreOfferProps = {
  snapshot: PendingQueueSnapshot;
  canRestore: boolean;
  isRestoring: boolean;
  onRestore: () => void;
  onDiscard: () => void;
};

export function PendingQueueRestoreOffer({
  snapshot,
  canRestore,
  isRestoring,
  onRestore,
  onDiscard,
}: PendingQueueRestoreOfferProps) {
  const count = snapshot.entries.length;
  // Escape is deliberately ignored: the only choices discard or restore the saved queue,
  // and discarding cannot be undone. The user must pick one with a button.
  const panelRef = useModalDialog();
  const startFreshRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Initial focus lands on Start fresh while the encoding tools are still being checked.
    // Move it to Restore queue once that becomes possible, unless the user already moved on.
    if (canRestore && document.activeElement === startFreshRef.current) restoreRef.current?.focus();
  }, [canRestore]);

  return (
    <div className="pending-queue-restore-overlay">
      <section
        aria-describedby="pending-queue-restore-description"
        aria-labelledby="pending-queue-restore-title"
        aria-modal="true"
        className="pending-queue-restore-panel"
        ref={panelRef}
        role="dialog"
      >
        <div className="pending-queue-restore-heading">
          <div className="pending-queue-restore-mark"><Icon name="queue" /></div>
          <div>
            <h2 id="pending-queue-restore-title">Restore your previous queue?</h2>
            <p id="pending-queue-restore-description">
              Vidra found {count} {count === 1 ? "video" : "videos"} that had not started encoding.
              Restore {count === 1 ? "it" : "them"} with the saved settings?
            </p>
          </div>
        </div>

        <div
          className="pending-queue-restore-list"
          role="region"
          aria-label="Saved videos"
          tabIndex={0}
        >
          {snapshot.entries.map((entry, index) => (
            <div className="pending-queue-restore-row" key={`${entry.sourcePath}-${index}`}>
              <Icon name="file" />
              <span title={entry.sourcePath}>{entry.sourceName}</span>
            </div>
          ))}
        </div>

        <p className="pending-queue-restore-note">
          Encoding will not start automatically. Files that are no longer at their saved locations
          will be left out and explained in the queue.
        </p>
        {!canRestore && (
          <p className="pending-queue-restore-status" role="status">
            Waiting for the local encoding tools…
          </p>
        )}

        <div className="pending-queue-restore-actions">
          <button
            autoFocus={!canRestore}
            className="secondary-button"
            ref={startFreshRef}
            type="button"
            onClick={onDiscard}
            disabled={isRestoring}
          >
            Start fresh
          </button>
          <button
            autoFocus={canRestore}
            className="primary-button"
            ref={restoreRef}
            type="button"
            onClick={onRestore}
            disabled={!canRestore || isRestoring}
          >
            {isRestoring ? "Restoring…" : "Restore queue"}
          </button>
        </div>
      </section>
    </div>
  );
}
