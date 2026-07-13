import type { CSSProperties } from "react";
import { QUALITY_LEVELS } from "../../config/quality";
import {
  encodingSpeed as getEncodingSpeed,
  videoCodec as getVideoCodec,
} from "../../config/encoding";
import type { EncodingSpeed, VideoCodec } from "../../types/media";

type QualitySliderProps = {
  qualityIndex: number;
  videoCodec: VideoCodec;
  encodingSpeed: EncodingSpeed;
  disabled: boolean;
  onChange: (qualityIndex: number) => void;
};

export function QualitySlider({
  qualityIndex,
  videoCodec,
  encodingSpeed,
  disabled,
  onChange,
}: QualitySliderProps) {
  const quality = QUALITY_LEVELS[qualityIndex];
  const codec = getVideoCodec(videoCodec);
  const speed = getEncodingSpeed(encodingSpeed);
  const copiesVideo = videoCodec === "copy";

  return (
    <section className="quality-card">
      <div className="section-heading">
        <div>
          <span className="section-label">VIDEO QUALITY &amp; SIZE</span>
          <strong>{copiesVideo ? "Original quality" : quality.label}</strong>
          <p>{copiesVideo ? "The video stream will be copied without re-encoding." : quality.description}</p>
        </div>
        <span className="codec-pill">
          {copiesVideo ? "No quality loss" : `${codec.label} · ${speed.label}`}
        </span>
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
          disabled={disabled || copiesVideo}
          style={{ "--slider-progress": `${qualityIndex * 25}%` } as CSSProperties}
        />
        <div className="slider-labels">
          <span>{copiesVideo ? "Original stream" : "Smaller file"}</span>
          <span>{copiesVideo ? "No re-encoding" : "Higher quality"}</span>
        </div>
      </div>
    </section>
  );
}
