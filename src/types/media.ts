export type View = "convert" | "queue" | "history" | "settings";
export type OutputContainer = "mp4" | "mkv";
export type VideoCodec = "h264" | "h265";

export type FfmpegStatus = {
  ready: boolean;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  error: string | null;
};

export type VideoStream = {
  codec: string;
  width: number;
  height: number;
  frameRate: number | null;
  pixelFormat: string | null;
};

export type AudioStream = {
  codec: string;
  channels: number | null;
  sampleRate: number | null;
  bitRate: number | null;
  language: string | null;
};

export type MediaInfo = {
  path: string;
  name: string;
  durationSeconds: number;
  sizeBytes: number;
  formatName: string;
  video: VideoStream | null;
  audio: AudioStream[];
};

export type EncodeProgress = {
  jobId: string;
  percent: number;
  outTimeSeconds: number;
  speed: string | null;
  frame: number | null;
};

export type EncodeFinished = {
  jobId: string;
  status: "completed" | "failed" | "cancelled";
  outputPath: string;
  error: string | null;
};

export type ApiError = {
  code?: string;
  message?: string;
};
