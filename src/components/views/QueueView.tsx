import type { EncodeQueueItem } from "../../types/media";
import { qualityLevel } from "../../config/quality";
import { audioModeLabel, videoCodecLabel } from "../../config/encoding";
import { outputResolutionLabel } from "../../config/resolution";
import { outputFrameRateLabel } from "../../config/advanced";
import { formatEta } from "../../lib/format";
import { Icon } from "../ui/Icon";
import { EmptyState } from "./shared";

type QueueViewProps = {
  items: EncodeQueueItem[];
  isReady: boolean;
  isProbing: boolean;
  error: string | null;
  controlItem: EncodeQueueItem | null;
  onAddVideos: () => void;
  onStart: () => void;
  onRevealOutput: (item: EncodeQueueItem) => void | Promise<void>;
  onRemoveOrCancel: (item: EncodeQueueItem) => void | Promise<void>;
  onToggleQueue: () => void | Promise<void>;
  onMove: (item: EncodeQueueItem, direction: -1 | 1) => void | Promise<void>;
  onEdit: (item: EncodeQueueItem) => void;
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
  isReady,
  isProbing,
  error,
  controlItem,
  onAddVideos,
  onStart,
  onRevealOutput,
  onRemoveOrCancel,
  onToggleQueue,
  onMove,
  onEdit,
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

  return (
    <div className="queue-view">
      <section className="queue-summary">
        <div>
          <span className="section-label">BATCH QUEUE</span>
          <strong>{items.length} {items.length === 1 ? "video" : "videos"}</strong>
          <p>Each video keeps its own format, resolution, codec, and quality settings.</p>
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
        <span><strong>{runningCount}</strong> in queue</span>
        <span><strong>{readyCount}</strong> ready</span>
        <span><strong>{completeCount}</strong> complete</span>
      </div>

      {controlItem && (
        <section className="queue-controller">
          <div>
            <span className="section-label">QUEUE CONTROL</span>
            <strong>
              {controlItem.status === "encoding"
                ? "Pause current encoding"
                : controlItem.status === "paused"
                  ? "Resume first video"
                  : "Start first video"}
            </strong>
            <p title={controlItem.media.name}>{controlItem.media.name}</p>
          </div>
          <button
            className="secondary-button queue-control-button"
            type="button"
            onClick={onToggleQueue}
            disabled={!isReady && controlItem.status !== "encoding"}
          >
            <Icon name={controlItem.status === "encoding" ? "pause" : "resume"} />
            {controlItem.status === "encoding"
              ? "Pause"
              : controlItem.status === "paused"
                ? "Resume"
                : "Start"}
          </button>
        </section>
      )}

      {error && <div className="error-message queue-message" role="alert">{error}</div>}

      <div className="queue-list">
        {items.map((item) => {
          const movable = items.filter((candidate) => item.status === "ready"
            ? candidate.status === "ready"
            : candidate.status === "queued" || candidate.status === "paused");
          const movableIndex = movable.findIndex((candidate) => candidate.clientId === item.clientId);
          const canMove = item.status === "ready" || item.status === "queued" || item.status === "paused";
          const isCurrent = item.status === "encoding" || item.status === "paused";
          const canRemove = canMove || isCurrent;
          const quality = qualityLevel(item.settings.quality);
          const videoSummary = item.settings.videoCodec === "copy"
            ? "Original video"
            : `${videoCodecLabel(item.settings.videoCodec)} · ${quality.label}`;
          const audioSummary = item.settings.audioMode === "none"
            ? "No audio"
            : `${audioModeLabel(item.settings.audioMode)} audio`;
          const frameRateSummary = item.settings.outputFrameRate === "source"
            ? ""
            : ` · ${outputFrameRateLabel(item.settings.outputFrameRate)}`;
          const settingsSummary = `${item.settings.container.toUpperCase()} · ${videoSummary} · ${outputResolutionLabel(item.settings.outputResolution)}${frameRateSummary} · ${audioSummary}`;

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
                <p className="queue-item-config">
                  {item.media.video ? `${item.media.video.width} × ${item.media.video.height} · ` : ""}
                  {settingsSummary}
                </p>
                {isCurrent && (
                  <p>
                    {item.status === "paused"
                      ? `${Math.round(item.progress.percent)}% · Paused`
                      : `${Math.round(item.progress.percent)}% · ${item.progress.speed ?? "Starting"} · ${formatEta(item.progress.etaSeconds)}`}
                  </p>
                )}
                {isCurrent && (
                  <div className="progress-track">
                    <div className="progress-value" style={{ width: `${item.progress.percent}%` }} />
                  </div>
                )}
                {item.status === "failed" && item.error && <p className="queue-error">{item.error}</p>}
              </div>
              <div className="queue-row-actions">
                {item.status === "completed" && (
                  <button
                    type="button"
                    aria-label={`Show output for ${item.media.name} in Finder`}
                    title="Show in Finder"
                    onClick={() => onRevealOutput(item)}
                  >
                    <Icon name="reveal" />
                  </button>
                )}
                {item.status === "ready" && (
                  <button
                    type="button"
                    aria-label={`Edit settings for ${item.media.name}`}
                    onClick={() => onEdit(item)}
                  >
                    <Icon name="settings" />
                  </button>
                )}
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
