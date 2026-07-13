import type { HistoryEntry } from "../../types/media";
import { historyDescription, historySummary } from "../../lib/history";
import { Icon } from "../ui/Icon";
import { EmptyState } from "./shared";

type HistoryViewProps = {
  items: HistoryEntry[];
  isLoading: boolean;
  error: string | null;
  onGoToConvert: () => void;
  onReveal: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
};

const statusLabels: Record<HistoryEntry["status"], string> = {
  completed: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function HistoryView({
  items,
  isLoading,
  error,
  onGoToConvert,
  onReveal,
  onDelete,
  onClear,
}: HistoryViewProps) {
  if (isLoading && items.length === 0) {
    return <div className="utility-view history-loading">Loading conversion history…</div>;
  }

  if (items.length === 0 && !error) {
    return (
      <div className="utility-view">
        <EmptyState
          icon="history"
          title="No conversions yet"
          copy="Finished conversions will be saved locally and appear here."
          action={onGoToConvert}
        />
      </div>
    );
  }

  function clearHistory() {
    if (window.confirm("Clear conversion history? Your media files will not be deleted.")) {
      void onClear();
    }
  }

  return (
    <div className="history-view">
      <section className="history-summary">
        <div>
          <span className="section-label">CONVERSION HISTORY</span>
          <strong>{items.length} saved {items.length === 1 ? "conversion" : "conversions"}</strong>
          <p>Stored only on this Mac. Removing entries never deletes media.</p>
        </div>
        {items.length > 0 && (
          <button className="secondary-button" type="button" onClick={clearHistory}>
            Clear history
          </button>
        )}
      </section>

      {error && <div className="error-message history-message" role="alert">{error}</div>}

      <div className="history-list">
        {items.map((item) => (
          <section className={`history-row ${item.status}`} key={item.id}>
            <div className={`history-status ${item.status}`} aria-hidden="true">
              {item.status === "completed" ? "✓" : item.status === "failed" ? "!" : "×"}
            </div>
            <div className="history-details">
              <div className="history-heading">
                <strong title={item.sourceName}>{item.sourceName}</strong>
                <span className={`history-status-label ${item.status}`}>{statusLabels[item.status]}</span>
              </div>
              <p className="history-metadata">{historySummary(item)}</p>
              <p className={item.status === "failed" ? "history-error" : ""} title={historyDescription(item)}>
                {historyDescription(item)}
              </p>
            </div>
            <div className="history-actions">
              {item.status === "completed" && (
                <button
                  type="button"
                  aria-label={`Show output for ${item.sourceName} in Finder`}
                  title="Show in Finder"
                  onClick={() => onReveal(item.id)}
                >
                  <Icon name="reveal" />
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${item.sourceName} from history`}
                title="Remove from history"
                onClick={() => onDelete(item.id)}
              >
                <Icon name="delete" />
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
