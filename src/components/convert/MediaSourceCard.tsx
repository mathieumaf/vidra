import { useMemo } from "react";
import { bitDepthLabel, hdrFormatLabel } from "../../lib/color";
import { formatBytes, formatDuration } from "../../lib/format";
import type { MediaInfo } from "../../types/media";
import { Icon } from "../ui/Icon";

export function MediaSourceCard({ media, count = 1 }: { media: MediaInfo; count?: number }) {
  const summary = useMemo(() => {
    const values = [formatDuration(media.durationSeconds), formatBytes(media.sizeBytes)];
    if (media.video) {
      values.unshift(`${media.video.width} × ${media.video.height}`);
      values.push(media.video.codec.toUpperCase());
      if (media.video.hdrFormat) values.push(hdrFormatLabel(media.video.hdrFormat));
      if (media.video.bitDepth) values.push(bitDepthLabel(media.video.bitDepth));
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
        <strong>{count > 1 ? `${count} videos selected` : media.name}</strong>
        <div className="media-summary">
          {count > 1
            ? <><span>{media.name}</span><span>{count - 1} more</span></>
            : summary.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
    </section>
  );
}
