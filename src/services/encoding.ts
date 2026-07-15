import { invoke } from "@tauri-apps/api/core";
import type {
  AudioMode,
  EncodingSpeed,
  EncodingSettings,
  FfmpegStatus,
  MediaInfo,
  OutputContainer,
  QueuedEncode,
  VideoCodec,
} from "../types/media";

export type EncodeRequest = {
  inputPath: string;
  outputPath: string;
  quality: EncodingSettings["quality"];
  container: OutputContainer;
  videoCodec: VideoCodec;
  encodingSpeed: EncodingSpeed;
  audioMode: AudioMode;
  outputResolution: EncodingSettings["outputResolution"];
  outputFrameRate: EncodingSettings["outputFrameRate"];
  qualityTuning: number;
  audioBitrate: EncodingSettings["audioBitrate"];
  audioChannels: EncodingSettings["audioChannels"];
  audioTrackMode: EncodingSettings["audioTrackMode"];
  audioStreamIndexes: number[];
  subtitleStreamIndexes: number[];
  preserveSubtitles: boolean;
  preserveMetadata: boolean;
  preserveChapters: boolean;
};

export function getFfmpegStatus(): Promise<FfmpegStatus> {
  return invoke("get_ffmpeg_status");
}

export function probeMedia(path: string): Promise<MediaInfo> {
  return invoke("probe_media", { path });
}

export function enqueueEncodes(requests: EncodeRequest[]): Promise<QueuedEncode[]> {
  return invoke("enqueue_encodes", { requests });
}

export function startEncodeQueue(): Promise<void> {
  return invoke("start_encode_queue");
}

export function cancelEncode(jobId: string): Promise<void> {
  return invoke("cancel_encode", { jobId });
}

export function setEncodePaused(jobId: string, paused: boolean): Promise<void> {
  return invoke("set_encode_paused", { jobId, paused });
}

export function moveQueuedEncode(jobId: string, direction: -1 | 1): Promise<void> {
  return invoke("move_queued_encode", { jobId, direction });
}
