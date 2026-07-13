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
  etaSeconds: number | null;
  frame: number | null;
};

export type EncodeFinished = {
  jobId: string;
  status: "completed" | "failed" | "cancelled";
  outputPath: string;
  error: string | null;
};

export type EncodeStarted = {
  jobId: string;
};

export type EncodePauseChanged = {
  jobId: string;
  paused: boolean;
};

export type QueuedEncode = {
  jobId: string;
  inputPath: string;
  outputPath: string;
};

export type EncodeJobStatus = "ready" | "queued" | "encoding" | "paused" | "completed" | "failed" | "cancelled";

export type EncodeQueueItem = {
  clientId: string;
  jobId: string | null;
  media: MediaInfo;
  outputPath: string | null;
  status: EncodeJobStatus;
  progress: EncodeProgress;
  error: string | null;
};

export type ApiError = {
  code?: string;
  message?: string;
};
