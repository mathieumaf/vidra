import { OUTPUT_CONTAINERS, VIDEO_CODECS } from "../../config/encoding";
import type { OutputContainer, VideoCodec } from "../../types/media";

type EncodingOptionsProps = {
  container: OutputContainer;
  videoCodec: VideoCodec;
  disabled: boolean;
  onContainerChange: (container: OutputContainer) => void;
  onVideoCodecChange: (codec: VideoCodec) => void;
};

export function EncodingOptions({
  container,
  videoCodec,
  disabled,
  onContainerChange,
  onVideoCodecChange,
}: EncodingOptionsProps) {
  return (
    <section className="encoding-options-card">
      <OptionGroup
        label="FORMAT"
        value={container}
        options={OUTPUT_CONTAINERS}
        disabled={disabled}
        onChange={onContainerChange}
      />
      <OptionGroup
        label="VIDEO CODEC"
        value={videoCodec}
        options={VIDEO_CODECS}
        disabled={disabled}
        onChange={onVideoCodecChange}
      />
    </section>
  );
}

type Option = {
  id: string;
  label: string;
  description: string;
};

type OptionGroupProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<Option & { id: T }>;
  disabled: boolean;
  onChange: (value: T) => void;
};

function OptionGroup<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: OptionGroupProps<T>) {
  return (
    <div className="option-group">
      <span className="section-label">{label}</span>
      <div className="segmented-options" role="radiogroup" aria-label={label.toLowerCase()}>
        {options.map((option) => (
          <button
            key={option.id}
            className={value === option.id ? "active" : ""}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            disabled={disabled}
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
