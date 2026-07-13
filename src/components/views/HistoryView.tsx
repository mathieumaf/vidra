import type { EncodeQueueItem } from "../../types/media";
import { EmptyState } from "./shared";

type HistoryViewProps = {
  items: EncodeQueueItem[];
  onGoToConvert: () => void;
};

export function HistoryView({ items, onGoToConvert }: HistoryViewProps) {
  const history = items.filter((item) => (
    item.status === "completed" || item.status === "failed" || item.status === "cancelled"
  ));

  if (history.length === 0) {
    return (
      <div className="utility-view">
        <EmptyState
          icon="history"
          title="No conversions yet"
          copy="Completed conversions from this session will appear here."
          action={onGoToConvert}
        />
      </div>
    );
  }

  return (
    <div className="history-view">
      {[...history].reverse().map((item) => (
        <section className="history-row" key={item.clientId}>
          <div className={`history-status ${item.status}`}>
            {item.status === "completed" ? "✓" : item.status === "failed" ? "!" : "×"}
          </div>
          <div>
            <strong>{item.media.name}</strong>
            <p>{item.status === "completed" ? item.outputPath : item.error ?? `Encoding ${item.status}`}</p>
          </div>
          <span>{item.status}</span>
        </section>
      ))}
    </div>
  );
}
