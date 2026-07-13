import { ENCODING_SPEEDS, OUTPUT_CONTAINERS, VIDEO_CODECS } from "../../config/encoding";
import type { EncodingSpeed, OutputContainer, VideoCodec } from "../../types/media";

type EncodingOptionsProps = {
  container: OutputContainer;
  videoCodec: VideoCodec;
  encodingSpeed: EncodingSpeed;
  disabled: boolean;
  onContainerChange: (container: OutputContainer) => void;
  onVideoCodecChange: (codec: VideoCodec) => void;
  onEncodingSpeedChange: (speed: EncodingSpeed) => void;
};

export function EncodingOptions({
  container,
  videoCodec,
  encodingSpeed,
  disabled,
  onContainerChange,
  onVideoCodecChange,
  onEncodingSpeedChange,
}: EncodingOptionsProps) {
  return (
    <section className="encoding-options-card">
      <OptionGroup
        label="FORMAT"
        value={container}
        options={OUTPUT_CONTAINERS}
        disabled={disabled}
        onChange={onContainerChange}
        className="format-group"
      />
      <OptionGroup
        label="VIDEO CODEC"
        value={videoCodec}
        options={VIDEO_CODECS}
        disabled={disabled}
        onChange={onVideoCodecChange}
        className="video-codec-group"
      />
      <OptionGroup
        label="ENCODING"
        value={encodingSpeed}
        options={ENCODING_SPEEDS}
        disabled={disabled || videoCodec === "copy" || videoCodec === "av1"}
        disabledReason={videoCodec === "copy"
          ? "Original video is copied without encoding"
          : videoCodec === "av1"
            ? "AV1 currently uses efficient software encoding"
            : undefined}
        onChange={onEncodingSpeedChange}
        className="encoding-speed-group"
      />
    </section>
  );
}

type Option = {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
};

type OptionGroupProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<Option & { id: T }>;
  disabled: boolean;
  disabledReason?: string;
  className?: string;
  onChange: (value: T) => void;
};

export function OptionGroup<T extends string>({
  label,
  value,
  options,
  disabled,
  disabledReason,
  className,
  onChange,
}: OptionGroupProps<T>) {
  return (
    <div className={`option-group${className ? ` ${className}` : ""}`}>
      <span className="section-label">{label}</span>
      <div className="segmented-options" role="radiogroup" aria-label={label.toLowerCase()}>
        {options.map((option) => (
          <button
            key={option.id}
            className={value === option.id ? "active" : ""}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            disabled={disabled || option.disabled}
            title={option.disabledReason ?? disabledReason}
            onClick={() => onChange(option.id)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
