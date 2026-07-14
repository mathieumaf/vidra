import {
  OUTPUT_RESOLUTIONS,
  outputDimensions,
  outputResolution,
  resolutionReducesVideo,
} from "../../config/resolution";
import type { OutputResolution, VideoCodec, VideoStream } from "../../types/media";

type ResolutionOptionsProps = {
  video: VideoStream | null;
  resolution: OutputResolution;
  videoCodec: VideoCodec;
  disabled: boolean;
  onChange: (resolution: OutputResolution) => void;
};

export function ResolutionOptions({
  video,
  resolution,
  videoCodec,
  disabled,
  onChange,
}: ResolutionOptionsProps) {
  const selected = outputResolution(resolution);
  const dimensions = outputDimensions(video, resolution);
  const copiesVideo = videoCodec === "copy";
  const summary = resolution === "source"
    ? dimensions
      ? `${dimensions.width} × ${dimensions.height} · No resizing`
      : "Keep the source dimensions"
    : dimensions
      ? `${dimensions.width} × ${dimensions.height} · Aspect ratio preserved`
      : `Up to ${selected.label}`;

  return (
    <section className="resolution-card">
      <div className="resolution-heading">
        <div>
          <span className="section-label">OUTPUT RESOLUTION</span>
          <strong>{resolution === "source" ? "Original resolution" : `Up to ${selected.label}`}</strong>
          <p>{summary}</p>
        </div>
        {copiesVideo && <span className="codec-pill">Original video requires original resolution</span>}
      </div>
      <div className="resolution-options" role="radiogroup" aria-label="Output resolution">
        {OUTPUT_RESOLUTIONS.map((option) => {
          const unavailable = option.id !== "source"
            && (!video || !resolutionReducesVideo(video, option.id));
          const unavailableReason = !video
            ? "The selected file has no video stream"
            : "The source is already within this resolution";
          return (
            <button
              key={option.id}
              className={resolution === option.id ? "active" : ""}
              type="button"
              role="radio"
              aria-checked={resolution === option.id}
              disabled={disabled || unavailable}
              title={unavailable ? unavailableReason : option.description}
              onClick={() => onChange(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
