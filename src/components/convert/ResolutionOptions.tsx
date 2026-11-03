import {
  OUTPUT_RESOLUTIONS,
  outputDimensions,
  outputResolution,
  resolutionReducesVideo,
} from "../../config/resolution";
import { useRadioGroup } from "../../hooks/useRadioGroup";
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
  const choices = OUTPUT_RESOLUTIONS.map((option) => {
    const unavailable = option.id !== "source" && (!video || !resolutionReducesVideo(video, option.id));
    return {
      ...option,
      disabled: disabled || unavailable,
      unavailable,
      unavailableReason: !video
        ? "The selected file has no video stream"
        : "The source is already within this resolution",
    };
  });
  const radio = useRadioGroup(choices, resolution, onChange);
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
      <div
        className="resolution-options"
        role="radiogroup"
        aria-label="Output resolution"
        onKeyDown={radio.onKeyDown}
      >
        {choices.map((option) => (
          <button
            key={option.id}
            className={resolution === option.id ? "active" : ""}
            type="button"
            {...radio.optionProps(option.id, option.disabled)}
            title={option.unavailable ? option.unavailableReason : option.description}
            onClick={() => {
              if (option.disabled) return;
              onChange(option.id);
            }}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
            {option.unavailable && <span className="visually-hidden">. {option.unavailableReason}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
