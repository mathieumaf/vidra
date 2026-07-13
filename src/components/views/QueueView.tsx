import type { EncodeProgress, MediaInfo, OutputContainer, VideoCodec } from "../../types/media";
import type { QualityLevel } from "../../config/quality";
import { formatEta } from "../../lib/format";
import { Icon } from "../ui/Icon";
import { EmptyState } from "./shared";

type QueueViewProps = {
  isEncoding: boolean;
  media: MediaInfo | null;
  quality: QualityLevel;
  outputContainer: OutputContainer;
  videoCodec: VideoCodec;
  progress: EncodeProgress;
  onCancel: () => void;
  onGoToConvert: () => void;
};

export function QueueView({
  isEncoding,
  media,
  quality,
  outputContainer,
  videoCodec,
  progress,
  onCancel,
  onGoToConvert,
}: QueueViewProps) {
  if (!isEncoding) {
    return (
      <div className="utility-view">
        <EmptyState
          icon="queue"
          title="Your queue is empty"
          copy="Start a conversion and its progress will appear here."
          action={onGoToConvert}
        />
      </div>
    );
  }

  return (
    <div className="utility-view">
      <section className="utility-card">
        <div className="utility-icon active"><Icon name="queue" /></div>
        <div className="utility-details">
          <span className="section-label">ENCODING NOW</span>
          <h2>{media?.name}</h2>
          <p>
            {quality.label} · {outputContainer.toUpperCase()} · {videoCodec === "h264" ? "H.264" : "H.265"} · {progress.speed ?? "Starting"}
          </p>
          <div className="progress-track">
            <div className="progress-value" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="queue-footer">
            <span>{Math.round(progress.percent)}% complete · {formatEta(progress.etaSeconds)}</span>
            <button className="text-button danger" type="button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </section>
    </div>
  );
}
