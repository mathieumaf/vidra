import { formatBitrate } from "../../lib/format";
import {
  audioTrackName,
  channelLabel,
  codecLabel,
  languageLabel,
  sampleRateLabel,
  subtitleTrackName,
} from "../../lib/tracks";
import type {
  AudioMode,
  AudioStream,
  AudioTrackMode,
  OutputContainer,
  SubtitleStream,
  TrackSelection,
} from "../../types/media";

type TrackSelectionOptionsProps = {
  audio: AudioStream[];
  subtitles: SubtitleStream[];
  container: OutputContainer;
  audioMode: AudioMode;
  selection: TrackSelection;
  disabled: boolean;
  onAudioChange: (indexes: number[], strategy?: AudioTrackMode) => void;
  onSubtitleChange: (indexes: number[]) => void;
};

export function TrackSelectionOptions({
  audio,
  subtitles,
  container,
  audioMode,
  selection,
  disabled,
  onAudioChange,
  onSubtitleChange,
}: TrackSelectionOptionsProps) {
  const audioIndexes = audio.map((track) => track.index);
  const subtitleIndexes = subtitles.map((track) => track.index);
  const audioDisabled = disabled || audioMode === "none" || audio.length === 0;
  const subtitlesDisabled = disabled || container !== "mkv" || subtitles.length === 0;
  const allAudioSelected = audio.length > 0
    && sameIndexes(selection.audioStreamIndexes, audioIndexes);
  const firstAudioSelected = !allAudioSelected && selection.audioStreamIndexes.length === 1
    && selection.audioStreamIndexes[0] === audioIndexes[0];
  const allSubtitlesSelected = subtitles.length > 0
    && sameIndexes(selection.subtitleStreamIndexes, subtitleIndexes);

  function changeAudioTrack(index: number, selected: boolean) {
    const indexes = toggleIndex(audioIndexes, selection.audioStreamIndexes, index, selected);
    const strategy = sameIndexes(indexes, audioIndexes)
      ? "all"
      : indexes.length === 1 && indexes[0] === audioIndexes[0]
        ? "first"
        : undefined;
    onAudioChange(indexes, strategy);
  }

  function changeSubtitleTrack(index: number, selected: boolean) {
    onSubtitleChange(toggleIndex(
      subtitleIndexes,
      selection.subtitleStreamIndexes,
      index,
      selected,
    ));
  }

  return (
    <section className="track-selection-card">
      <div className="track-selection-heading">
        <div>
          <span className="section-label">TRACK SELECTION</span>
          <strong>Choose what to keep</strong>
          <p>Selections belong to this video. Profiles only remember the general strategy.</p>
        </div>
      </div>

      <div className="track-selection-grid">
        <div className="track-selection-group">
          <TrackGroupHeading
            label="Audio tracks"
            selected={audioMode === "none" ? 0 : selection.audioStreamIndexes.length}
            total={audio.length}
          />
          <div className="track-shortcuts" aria-label="Audio track shortcuts">
            <Shortcut
              label="All"
              active={allAudioSelected}
              disabled={audioDisabled}
              onClick={() => onAudioChange(audioIndexes, "all")}
            />
            <Shortcut
              label="First"
              active={firstAudioSelected}
              disabled={audioDisabled}
              onClick={() => onAudioChange(audioIndexes.slice(0, 1), "first")}
            />
            <Shortcut
              label="None"
              active={selection.audioStreamIndexes.length === 0}
              disabled={audioDisabled}
              onClick={() => onAudioChange([])}
            />
          </div>
          {audioMode === "none" && audio.length > 0 && (
            <p className="track-selection-notice">Selection retained while audio output is off.</p>
          )}
          <div className="track-selection-list">
            {audio.length > 0 ? audio.map((track, index) => (
              <AudioTrackOption
                key={track.index}
                track={track}
                index={index}
                checked={selection.audioStreamIndexes.includes(track.index)}
                disabled={audioDisabled}
                onChange={(checked) => changeAudioTrack(track.index, checked)}
              />
            )) : <p className="empty-track-copy">No audio tracks found.</p>}
          </div>
        </div>

        <div className="track-selection-group">
          <TrackGroupHeading
            label="Subtitle tracks"
            selected={container === "mkv" ? selection.subtitleStreamIndexes.length : 0}
            total={subtitles.length}
          />
          <div className="track-shortcuts" aria-label="Subtitle track shortcuts">
            <Shortcut
              label="All"
              active={allSubtitlesSelected}
              disabled={subtitlesDisabled}
              onClick={() => onSubtitleChange(subtitleIndexes)}
            />
            <Shortcut
              label="None"
              active={selection.subtitleStreamIndexes.length === 0}
              disabled={subtitlesDisabled}
              onClick={() => onSubtitleChange([])}
            />
          </div>
          {container !== "mkv" && subtitles.length > 0 && (
            <p className="track-selection-notice">Selection retained. Subtitle copying is available with MKV.</p>
          )}
          <div className="track-selection-list">
            {subtitles.length > 0 ? subtitles.map((track, index) => (
              <SubtitleTrackOption
                key={track.index}
                track={track}
                index={index}
                checked={selection.subtitleStreamIndexes.includes(track.index)}
                disabled={subtitlesDisabled}
                onChange={(checked) => changeSubtitleTrack(track.index, checked)}
              />
            )) : <p className="empty-track-copy">No subtitle tracks found.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackGroupHeading({
  label,
  selected,
  total,
}: {
  label: string;
  selected: number;
  total: number;
}) {
  return (
    <div className="track-group-heading">
      <strong>{label}</strong>
      <span>{selected}/{total} selected</span>
    </div>
  );
}

function Shortcut({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >{label}</button>
  );
}

function AudioTrackOption({
  track,
  index,
  checked,
  disabled,
  onChange,
}: {
  track: AudioStream;
  index: number;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const language = languageLabel(track.language);
  return (
    <label className="track-selection-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={`Keep ${audioTrackName(track, index)}`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track-option-details">
        <span className="track-option-title">
          <strong>{audioTrackName(track, index)}</strong>
          {language && <span>{language}</span>}
        </span>
        <span className="track-option-facts">
          {[
            codecLabel(track.codec),
            channelLabel(track.channels),
            track.bitRate ? formatBitrate(track.bitRate) : "Unknown bitrate",
            sampleRateLabel(track.sampleRate),
          ].join(" · ")}
        </span>
      </span>
    </label>
  );
}

function SubtitleTrackOption({
  track,
  index,
  checked,
  disabled,
  onChange,
}: {
  track: SubtitleStream;
  index: number;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const language = languageLabel(track.language);
  return (
    <label className="track-selection-row compact-track-option">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={`Keep ${subtitleTrackName(track, index)}`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track-option-details">
        <span className="track-option-title">
          <strong>{subtitleTrackName(track, index)}</strong>
          {language && <span>{language}</span>}
          {track.isDefault && <span>Default</span>}
          {track.isForced && <span>Forced</span>}
        </span>
        <span className="track-option-facts">{codecLabel(track.codec)}</span>
      </span>
    </label>
  );
}

function toggleIndex(
  available: number[],
  selected: number[],
  index: number,
  checked: boolean,
): number[] {
  const next = new Set(selected);
  if (checked) next.add(index);
  else next.delete(index);
  return available.filter((candidate) => next.has(candidate));
}

function sameIndexes(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
