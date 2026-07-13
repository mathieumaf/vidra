import type { CSSProperties } from "react";
import { QUALITY_LEVELS } from "../../config/quality";
import { videoCodec as getVideoCodec } from "../../config/encoding";
import type { VideoCodec } from "../../types/media";

type QualitySliderProps = {
  qualityIndex: number;
  videoCodec: VideoCodec;
  disabled: boolean;
  onChange: (qualityIndex: number) => void;
};

export function QualitySlider({ qualityIndex, videoCodec, disabled, onChange }: QualitySliderProps) {
  const quality = QUALITY_LEVELS[qualityIndex];
  const codec = getVideoCodec(videoCodec);

  return (
    <section className="quality-card">
      <div className="section-heading">
        <div>
          <span className="section-label">QUALITY &amp; SIZE</span>
          <strong>{quality.label}</strong>
          <p>{quality.description}</p>
        </div>
        <span className="codec-pill">{codec.label} · CRF {quality.crf[videoCodec]}</span>
      </div>
      <div className="quality-slider-wrap">
        <input
          aria-label="Quality and file size"
          type="range"
          min="0"
          max="4"
          step="1"
          value={qualityIndex}
          onChange={(event) => onChange(Number(event.target.value))}
          disabled={disabled}
          style={{ "--slider-progress": `${qualityIndex * 25}%` } as CSSProperties}
        />
        <div className="slider-labels">
          <span>Smaller file</span>
          <span>Higher quality</span>
        </div>
      </div>
    </section>
  );
}
