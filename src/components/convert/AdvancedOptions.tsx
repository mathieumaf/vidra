import type { CSSProperties } from "react";
import {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_CHANNEL_OPTIONS,
  AUDIO_TRACK_OPTIONS,
  FRAME_RATE_OPTIONS,
  QUALITY_TUNING_LABELS,
  frameRateReducesVideo,
  type AdvancedEncodingSettings,
} from "../../config/advanced";
import type {
  AudioMode,
  AudioStream,
  OutputContainer,
  VideoCodec,
  VideoStream,
} from "../../types/media";

type AdvancedOptionsProps = {
  video: VideoStream | null;
  audio: AudioStream[];
  container: OutputContainer;
  videoCodec: VideoCodec;
  audioMode: AudioMode;
  settings: AdvancedEncodingSettings;
  disabled: boolean;
  onChange: (settings: Partial<AdvancedEncodingSettings>) => void;
};

export function AdvancedOptions({
  video,
  audio,
  container,
  videoCodec,
  audioMode,
  settings,
  disabled,
  onChange,
}: AdvancedOptionsProps) {
  const hasAudio = audio.length > 0 && audioMode !== "none";
  const canReduceToStereo = audio.some((stream) => (stream.channels ?? 2) > 2);
  const canReduceToMono = audio.some((stream) => (stream.channels ?? 2) > 1);
  const tuningIndex = settings.qualityTuning + 2;

  return (
    <section className="advanced-options-card">
      <div className="advanced-card-heading">
        <div>
          <span className="section-label">ADVANCED CONTROLS</span>
          <strong>Fine-tune this conversion</strong>
          <p>Original and automatic values preserve the standard Vidra behavior.</p>
        </div>
      </div>

      <div className="advanced-options-grid">
        <label className="advanced-field">
          <span>Frame rate</span>
          <select
            value={settings.outputFrameRate}
            disabled={disabled || !video}
            onChange={(event) => onChange({
              outputFrameRate: event.target.value as AdvancedEncodingSettings["outputFrameRate"],
            })}
          >
            {FRAME_RATE_OPTIONS.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={option.id !== "source" && !frameRateReducesVideo(video, option.id)}
              >
                {option.label}
              </option>
            ))}
          </select>
          <small>Lower frame rates reduce motion data without creating new frames.</small>
        </label>

        <div className="advanced-quality-field">
          <div>
            <span>Quality fine tuning</span>
            <strong>{QUALITY_TUNING_LABELS[tuningIndex]}</strong>
          </div>
          <input
            aria-label="Quality fine tuning"
            type="range"
            min="-2"
            max="2"
            step="1"
            value={settings.qualityTuning}
            disabled={disabled || videoCodec === "copy"}
            style={{ "--advanced-progress": `${tuningIndex * 25}%` } as CSSProperties}
            onChange={(event) => onChange({ qualityTuning: Number(event.target.value) })}
          />
          <div className="advanced-slider-labels"><span>Smaller</span><span>More detail</span></div>
        </div>

        <label className="advanced-field">
          <span>Audio bitrate</span>
          <select
            value={settings.audioBitrate}
            disabled={disabled || !hasAudio}
            onChange={(event) => onChange({
              audioBitrate: event.target.value as AdvancedEncodingSettings["audioBitrate"],
            })}
          >
            {AUDIO_BITRATE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <small>Known source bitrates are never increased.</small>
        </label>

        <label className="advanced-field">
          <span>Audio channels</span>
          <select
            value={settings.audioChannels}
            disabled={disabled || !hasAudio}
            onChange={(event) => onChange({
              audioChannels: event.target.value as AdvancedEncodingSettings["audioChannels"],
            })}
          >
            {AUDIO_CHANNEL_OPTIONS.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={(option.id === "stereo" && !canReduceToStereo)
                  || (option.id === "mono" && !canReduceToMono)}
              >
                {option.label}
              </option>
            ))}
          </select>
          <small>Channels are only reduced, never added.</small>
        </label>

        <label className="advanced-field">
          <span>Audio tracks</span>
          <select
            value={settings.audioTrackMode}
            disabled={disabled || !hasAudio || audio.length < 2}
            onChange={(event) => onChange({
              audioTrackMode: event.target.value as AdvancedEncodingSettings["audioTrackMode"],
            })}
          >
            {AUDIO_TRACK_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <small>{audio.length > 1 ? `${audio.length} source tracks available.` : "One source track available."}</small>
        </label>

        <div className="preservation-field">
          <span>Preserve source information</span>
          <Toggle
            label="Subtitles"
            checked={settings.preserveSubtitles}
            disabled={disabled || container !== "mkv"}
            title={container !== "mkv" ? "Compatible subtitle preservation is available with MKV" : undefined}
            onChange={(preserveSubtitles) => onChange({ preserveSubtitles })}
          />
          <Toggle
            label="Metadata"
            checked={settings.preserveMetadata}
            disabled={disabled}
            onChange={(preserveMetadata) => onChange({ preserveMetadata })}
          />
          <Toggle
            label="Chapters"
            checked={settings.preserveChapters}
            disabled={disabled}
            onChange={(preserveChapters) => onChange({ preserveChapters })}
          />
        </div>
      </div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  title,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="advanced-toggle" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
