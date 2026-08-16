import type { PendingQueueSnapshot } from "../../lib/pendingQueue";
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

  return (
    <div className="pending-queue-restore-overlay">
      <section
        aria-describedby="pending-queue-restore-description"
        aria-labelledby="pending-queue-restore-title"
        aria-modal="true"
        className="pending-queue-restore-panel"
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

        <div className="pending-queue-restore-list">
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
            className="secondary-button"
            type="button"
            onClick={onDiscard}
            disabled={isRestoring}
          >
            Start fresh
          </button>
          <button
            autoFocus
            className="primary-button"
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
