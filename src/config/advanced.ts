import type {
  AudioBitrate,
  AudioChannels,
  AudioTrackMode,
  EncodingSettings,
  OutputFrameRate,
  VideoStream,
} from "../types/media";

export const FRAME_RATE_OPTIONS: ReadonlyArray<{
  id: OutputFrameRate;
  label: string;
}> = [
  { id: "source", label: "Original" },
  { id: "24", label: "24 fps" },
  { id: "25", label: "25 fps" },
  { id: "30", label: "30 fps" },
  { id: "50", label: "50 fps" },
  { id: "60", label: "60 fps" },
];

export const AUDIO_BITRATE_OPTIONS: ReadonlyArray<{
  id: AudioBitrate;
  label: string;
}> = [
  { id: "auto", label: "Automatic" },
  { id: "96", label: "96 kbps" },
  { id: "128", label: "128 kbps" },
  { id: "160", label: "160 kbps" },
  { id: "192", label: "192 kbps" },
  { id: "256", label: "256 kbps" },
];

export const AUDIO_CHANNEL_OPTIONS: ReadonlyArray<{
  id: AudioChannels;
  label: string;
}> = [
  { id: "source", label: "Original" },
  { id: "stereo", label: "Stereo" },
  { id: "mono", label: "Mono" },
];

export const AUDIO_TRACK_OPTIONS: ReadonlyArray<{
  id: AudioTrackMode;
  label: string;
}> = [
  { id: "all", label: "All tracks" },
  { id: "first", label: "First track" },
];

export const QUALITY_TUNING_LABELS = [
  "Much smaller",
  "Slightly smaller",
  "Standard",
  "More detail",
  "Maximum detail",
] as const;

export type AdvancedEncodingSettings = Pick<
  EncodingSettings,
  | "outputFrameRate"
  | "qualityTuning"
  | "audioBitrate"
  | "audioChannels"
  | "audioTrackMode"
  | "preserveSubtitles"
  | "preserveMetadata"
  | "preserveChapters"
>;

export const DEFAULT_ADVANCED_SETTINGS: AdvancedEncodingSettings = {
  outputFrameRate: "source",
  qualityTuning: 0,
  audioBitrate: "auto",
  audioChannels: "source",
  audioTrackMode: "all",
  preserveSubtitles: true,
  preserveMetadata: true,
  preserveChapters: true,
};

export function advancedSettings(settings: EncodingSettings): AdvancedEncodingSettings {
  return {
    outputFrameRate: settings.outputFrameRate,
    qualityTuning: settings.qualityTuning,
    audioBitrate: settings.audioBitrate,
    audioChannels: settings.audioChannels,
    audioTrackMode: settings.audioTrackMode,
    preserveSubtitles: settings.preserveSubtitles,
    preserveMetadata: settings.preserveMetadata,
    preserveChapters: settings.preserveChapters,
  };
}

export function frameRateReducesVideo(
  video: VideoStream | null,
  frameRate: OutputFrameRate,
): boolean {
  if (frameRate === "source" || video?.frameRate === null || !video) return false;
  return Number(frameRate) < video.frameRate - 0.01;
}

export function outputFrameRateLabel(frameRate: OutputFrameRate): string {
  return FRAME_RATE_OPTIONS.find((option) => option.id === frameRate)?.label ?? "Original";
}
