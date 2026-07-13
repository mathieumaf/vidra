import type {
  AudioMode,
  AudioStream,
  EncodingSpeed,
  OutputContainer,
  VideoCodec,
  VideoStream,
} from "../types/media";

export const OUTPUT_CONTAINERS: ReadonlyArray<{
  id: OutputContainer;
  label: string;
  description: string;
  extension: string;
  filterName: string;
}> = [
  {
    id: "mp4",
    label: "MP4",
    description: "Broad compatibility",
    extension: "mp4",
    filterName: "MPEG-4 video",
  },
  {
    id: "mkv",
    label: "MKV",
    description: "Flexible tracks",
    extension: "mkv",
    filterName: "Matroska video",
  },
];

export const VIDEO_CODECS: ReadonlyArray<{
  id: VideoCodec;
  label: string;
  description: string;
}> = [
  { id: "copy", label: "Original", description: "No re-encoding" },
  { id: "h264", label: "H.264", description: "Best compatibility" },
  { id: "h265", label: "H.265", description: "Smaller files" },
  { id: "av1", label: "AV1", description: "Smallest · MKV" },
];

export const ENCODING_SPEEDS: ReadonlyArray<{
  id: EncodingSpeed;
  label: string;
  description: string;
}> = [
  { id: "efficient", label: "Efficient", description: "Better compression" },
  { id: "fast", label: "Fast", description: "Apple hardware" },
];

export const AUDIO_MODES: ReadonlyArray<{
  id: AudioMode;
  label: string;
  description: string;
}> = [
  { id: "auto", label: "Auto", description: "Recommended" },
  { id: "copy", label: "Original", description: "No quality loss" },
  { id: "aac", label: "AAC", description: "Compatible" },
  { id: "opus", label: "Opus", description: "Smaller · MKV" },
  { id: "none", label: "None", description: "Silent video" },
];

export function outputContainer(container: OutputContainer) {
  return OUTPUT_CONTAINERS.find((option) => option.id === container) ?? OUTPUT_CONTAINERS[0];
}

export function videoCodec(codec: VideoCodec) {
  return VIDEO_CODECS.find((option) => option.id === codec) ?? VIDEO_CODECS[0];
}

export function encodingSpeed(speed: EncodingSpeed) {
  return ENCODING_SPEEDS.find((option) => option.id === speed) ?? ENCODING_SPEEDS[0];
}

export function audioMode(mode: AudioMode) {
  return AUDIO_MODES.find((option) => option.id === mode) ?? AUDIO_MODES[0];
}

export function canCopyVideoToMp4(video: VideoStream | null): boolean {
  return video !== null && ["h264", "hevc", "av1", "mpeg4"].includes(video.codec.toLowerCase());
}

export function canCopyAudioToMp4(audio: AudioStream[]): boolean {
  return audio.every((stream) => stream.codec.toLowerCase() === "aac");
}

export function videoCodecLabel(codec: VideoCodec): string {
  return videoCodec(codec).label;
}

export function audioModeLabel(mode: AudioMode): string {
  return audioMode(mode).label;
}
