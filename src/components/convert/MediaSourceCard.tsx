import { useMemo } from "react";
import { formatBytes, formatDuration } from "../../lib/format";
import type { MediaInfo } from "../../types/media";
import { Icon } from "../ui/Icon";

export function MediaSourceCard({ media }: { media: MediaInfo }) {
  const summary = useMemo(() => {
    const values = [formatDuration(media.durationSeconds), formatBytes(media.sizeBytes)];
    if (media.video) {
      values.unshift(`${media.video.width} × ${media.video.height}`);
      values.push(media.video.codec.toUpperCase());
    }
    return values;
  }, [media]);

  return (
    <section className="source-card">
      <div className="file-icon compact">
        <Icon name="file" />
      </div>
      <div className="source-details">
        <span className="section-label">SOURCE</span>
        <strong>{media.name}</strong>
        <div className="media-summary">
          {summary.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
    </section>
  );
}
