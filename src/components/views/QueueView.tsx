import type { EncodeQueueItem, OutputContainer, VideoCodec } from "../../types/media";
import type { QualityLevel } from "../../config/quality";
import { formatEta } from "../../lib/format";
import { Icon } from "../ui/Icon";
import { EmptyState } from "./shared";

type QueueViewProps = {
  items: EncodeQueueItem[];
  quality: QualityLevel;
  outputContainer: OutputContainer;
  videoCodec: VideoCodec;
  isReady: boolean;
  isProbing: boolean;
  error: string | null;
  onAddVideos: () => void;
  onStart: () => void;
  onRemoveOrCancel: (item: EncodeQueueItem) => void | Promise<void>;
  onTogglePause: (item: EncodeQueueItem) => void | Promise<void>;
  onMove: (item: EncodeQueueItem, direction: -1 | 1) => void | Promise<void>;
  onGoToConvert: () => void;
};

const statusLabels: Record<EncodeQueueItem["status"], string> = {
  ready: "Ready",
  queued: "Waiting",
  encoding: "Encoding",
  paused: "Paused",
  completed: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function QueueView({
  items,
  quality,
  outputContainer,
  videoCodec,
  isReady,
  isProbing,
  error,
  onAddVideos,
  onStart,
  onRemoveOrCancel,
  onTogglePause,
  onMove,
  onGoToConvert,
}: QueueViewProps) {
  if (items.length === 0) {
    return (
      <div className="utility-view">
        <EmptyState
          icon="queue"
          title="Your queue is empty"
          copy="Choose one or more videos to create a batch conversion."
          action={onGoToConvert}
        />
      </div>
    );
  }

  const readyCount = items.filter((item) => item.status === "ready").length;
  const runningCount = items.filter((item) => (
    item.status === "queued" || item.status === "encoding" || item.status === "paused"
  )).length;
  const completeCount = items.filter((item) => item.status === "completed").length;
  const movable = items.filter((item) => item.status === "ready" || item.status === "queued");

  return (
    <div className="queue-view">
      <section className="queue-summary">
        <div>
          <span className="section-label">BATCH QUEUE</span>
          <strong>{items.length} {items.length === 1 ? "video" : "videos"}</strong>
          <p>
            {quality.label} · {outputContainer.toUpperCase()} · {videoCodec === "h264" ? "H.264" : "H.265"}
          </p>
        </div>
        <div className="queue-summary-actions">
          <button className="secondary-button" type="button" onClick={onAddVideos} disabled={isProbing}>
            {isProbing ? "Reading…" : "Add videos"}
          </button>
          {readyCount > 0 && (
            <button className="primary-button" type="button" onClick={onStart} disabled={!isReady || isProbing}>
              {runningCount > 0 ? "Add" : "Encode"} {readyCount} {readyCount === 1 ? "video" : "videos"} <span>→</span>
            </button>
          )}
        </div>
      </section>

      <div className="queue-stats" aria-label="Queue summary">
        <span><strong>{runningCount}</strong> active</span>
        <span><strong>{readyCount}</strong> ready</span>
        <span><strong>{completeCount}</strong> complete</span>
      </div>

      {error && <div className="error-message queue-message" role="alert">{error}</div>}

      <div className="queue-list">
        {items.map((item) => {
          const movableIndex = movable.findIndex((candidate) => candidate.clientId === item.clientId);
          const canMove = item.status === "ready" || item.status === "queued";
          const isCurrent = item.status === "encoding" || item.status === "paused";
          const canRemove = canMove || isCurrent;

          return (
            <section className={`queue-row ${item.status}`} key={item.clientId}>
              <div className={`queue-status-mark ${item.status}`} aria-hidden="true">
                {item.status === "completed" ? "✓" : item.status === "failed" ? "!" : <Icon name="file" />}
              </div>
              <div className="queue-item-details">
                <div className="queue-item-heading">
                  <strong title={item.media.name}>{item.media.name}</strong>
                  <span className={`queue-status-label ${item.status}`}>{statusLabels[item.status]}</span>
                </div>
                <p>
                  {item.media.video ? `${item.media.video.width} × ${item.media.video.height} · ` : ""}
                  {isCurrent
                    ? item.status === "paused"
                      ? `${Math.round(item.progress.percent)}% · Paused`
                      : `${Math.round(item.progress.percent)}% · ${item.progress.speed ?? "Starting"} · ${formatEta(item.progress.etaSeconds)}`
                    : item.outputPath ?? "Output will be chosen when the batch starts"}
                </p>
                {isCurrent && (
                  <div className="progress-track">
                    <div className="progress-value" style={{ width: `${item.progress.percent}%` }} />
                  </div>
                )}
                {item.status === "failed" && item.error && <p className="queue-error">{item.error}</p>}
              </div>
              <div className="queue-row-actions">
                {canMove && (
                  <>
                    <button
                      type="button"
                      aria-label={`Move ${item.media.name} up`}
                      disabled={movableIndex <= 0}
                      onClick={() => onMove(item, -1)}
                    >
                      <Icon name="up" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${item.media.name} down`}
                      disabled={movableIndex < 0 || movableIndex >= movable.length - 1}
                      onClick={() => onMove(item, 1)}
                    >
                      <Icon name="down" />
                    </button>
                  </>
                )}
                {isCurrent && (
                  <button
                    type="button"
                    aria-label={`${item.status === "paused" ? "Resume" : "Pause"} ${item.media.name}`}
                    onClick={() => onTogglePause(item)}
                  >
                    <Icon name={item.status === "paused" ? "resume" : "pause"} />
                  </button>
                )}
                {canRemove && (
                  <button
                    className={isCurrent ? "danger" : ""}
                    type="button"
                    aria-label={`${isCurrent ? "Cancel" : "Remove"} ${item.media.name}`}
                    onClick={() => onRemoveOrCancel(item)}
                  >
                    <Icon name="remove" />
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
