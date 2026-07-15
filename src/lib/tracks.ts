import type {
  AudioStream,
  EncodeQueueItem,
  SubtitleStream,
} from "../types/media";

export function audioTrackName(track: AudioStream, index: number): string {
  return track.title ? `Audio ${index + 1} · ${track.title}` : `Audio ${index + 1}`;
}

export function subtitleTrackName(track: SubtitleStream, index: number): string {
  return track.title ? `Subtitle ${index + 1} · ${track.title}` : `Subtitle ${index + 1}`;
}

export function codecLabel(codec: string): string {
  return codec === "unknown" ? "Unknown codec" : codec.toUpperCase();
}

export function languageLabel(language: string | null): string | null {
  return language?.toUpperCase() ?? null;
}

export function channelLabel(channels: number | null): string {
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return channels ? `${channels} channels` : "Unknown channels";
}

export function sampleRateLabel(sampleRate: number | null): string {
  if (!sampleRate) return "Unknown sample rate";
  return `${Number((sampleRate / 1000).toFixed(1))} kHz`;
}

export function queueTrackSummary(item: EncodeQueueItem): string {
  const selectedAudio = item.settings.audioMode === "none"
    ? []
    : item.media.audio.filter((track) => (
      item.trackSelection.audioStreamIndexes.includes(track.index)
    ));
  const selectedSubtitles = item.settings.container === "mkv" && item.settings.preserveSubtitles
    ? item.media.subtitles.filter((track) => (
      item.trackSelection.subtitleStreamIndexes.includes(track.index)
    ))
    : [];

  const audio = item.media.audio.length === 0
    ? "No audio tracks"
    : selectionSummary("Audio", selectedAudio, item.media.audio.length);
  const subtitles = item.media.subtitles.length === 0
    ? "No subtitles"
    : item.settings.container !== "mkv"
      ? "Subtitles off in MP4"
      : selectionSummary("Subtitles", selectedSubtitles, item.media.subtitles.length);
  return `${audio} · ${subtitles}`;
}

function selectionSummary(
  label: string,
  tracks: Array<{ language: string | null }>,
  total: number,
): string {
  const languages = [...new Set(tracks.flatMap((track) => (
    track.language ? [track.language.toUpperCase()] : []
  )))];
  const languageSummary = languages.length > 0 ? ` · ${languages.join(", ")}` : "";
  return `${label} ${tracks.length}/${total}${languageSummary}`;
}
