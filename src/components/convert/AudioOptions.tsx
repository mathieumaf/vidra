import { AUDIO_MODES, canCopyAudioToMp4 } from "../../config/encoding";
import type { AudioMode, AudioStream, OutputContainer } from "../../types/media";
import { Icon } from "../ui/Icon";
import { OptionGroup } from "./EncodingOptions";

type AudioOptionsProps = {
  audio: AudioStream[];
  container: OutputContainer;
  mode: AudioMode;
  disabled: boolean;
  onChange: (mode: AudioMode) => void;
};

export function AudioOptions({
  audio,
  container,
  mode,
  disabled,
  onChange,
}: AudioOptionsProps) {
  const hasAudio = audio.length > 0;
  const options = AUDIO_MODES.map((option) => ({
    ...option,
    disabled: !hasAudio && option.id !== "auto" && option.id !== "none",
    disabledReason: !hasAudio ? "The selected video has no audio tracks" : undefined,
  }));

  return (
    <section className="audio-options-card">
      <div className="audio-options-heading">
        <span className="audio-icon"><Icon name="audio" /></span>
        <div>
          <span className="section-label">AUDIO</span>
          <span>{audioDescription(audio, container, mode)}</span>
        </div>
      </div>
      <OptionGroup
        label="AUDIO MODE"
        value={mode}
        options={options}
        disabled={disabled}
        onChange={onChange}
        className="audio-mode-group"
      />
    </section>
  );
}

function audioDescription(
  audio: AudioStream[],
  container: OutputContainer,
  mode: AudioMode,
): string {
  if (audio.length === 0) return "No audio tracks found";
  switch (mode) {
    case "auto":
      return container === "mkv" || canCopyAudioToMp4(audio)
        ? "Compatible tracks will stay untouched"
        : "Incompatible tracks will be converted to AAC";
    case "copy":
      return "Every audio track will stay untouched";
    case "aac":
      return "AAC tracks stay untouched; other tracks are converted";
    case "opus":
      return "Efficient audio compression for MKV files";
    case "none":
      return "The output will contain no audio";
  }
}
