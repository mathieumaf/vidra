import type { EncodeFinished, MediaInfo } from "../../types/media";
import { EmptyState } from "./shared";

type HistoryViewProps = {
  result: EncodeFinished | null;
  media: MediaInfo | null;
  onGoToConvert: () => void;
};

export function HistoryView({ result, media, onGoToConvert }: HistoryViewProps) {
  if (!result) {
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
    <div className="utility-view">
      <section className="history-row">
        <div className={`history-status ${result.status}`}>
          {result.status === "completed" ? "✓" : "×"}
        </div>
        <div>
          <strong>{media?.name ?? "Video conversion"}</strong>
          <p>{result.status === "completed" ? result.outputPath : `Encoding ${result.status}`}</p>
        </div>
        <span>{result.status}</span>
      </section>
    </div>
  );
}
