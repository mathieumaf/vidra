export type View = "convert" | "queue" | "history" | "settings";
export type OutputContainer = "mp4" | "mkv";
export type VideoCodec = "copy" | "h264" | "h265" | "av1";
export type EncodingSpeed = "efficient" | "fast";
export type AudioMode = "auto" | "copy" | "aac" | "opus" | "none";
export type OutputResolution =
  | "source"
  | "2160p"
  | "1440p"
  | "1080p"
  | "720p"
  | "480p"
  | "360p";
export type OutputFrameRate = "source" | "24" | "25" | "30" | "50" | "60";
export type AudioBitrate = "auto" | "96" | "128" | "160" | "192" | "256";
export type AudioChannels = "source" | "stereo" | "mono";
export type AudioTrackMode = "all" | "first";
export type QualityLevelId =
  | "maximum-compression"
  | "smaller-file"
  | "balanced"
  | "high-quality"
  | "near-source";

export type EncodingSettings = {
  quality: QualityLevelId;
  container: OutputContainer;
  videoCodec: VideoCodec;
  encodingSpeed: EncodingSpeed;
  audioMode: AudioMode;
  outputResolution: OutputResolution;
  outputFrameRate: OutputFrameRate;
  qualityTuning: number;
  audioBitrate: AudioBitrate;
  audioChannels: AudioChannels;
  audioTrackMode: AudioTrackMode;
  preserveSubtitles: boolean;
  preserveMetadata: boolean;
  preserveChapters: boolean;
};

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
  bitDepth: number | null;
  colorRange: string | null;
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  hdrFormat: HdrFormat | null;
};

export type HdrFormat = "dolby-vision" | "hdr10-plus" | "hdr10" | "hlg" | "pq" | "hdr";

export type AudioStream = {
  index: number;
  codec: string;
  channels: number | null;
  sampleRate: number | null;
  bitRate: number | null;
  language: string | null;
  title: string | null;
};

export type SubtitleStream = {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
};

export type MediaInfo = {
  path: string;
  name: string;
  durationSeconds: number;
  sizeBytes: number;
  formatName: string;
  formatLongName: string | null;
  video: VideoStream | null;
  audio: AudioStream[];
  subtitles: SubtitleStream[];
  chapterCount: number;
  hasMetadata: boolean;
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
  diagnostic: DiagnosticReport | null;
};

export type DiagnosticReport = {
  code: string;
  summary: string;
  report: string;
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

export type TrackSelection = {
  audioStreamIndexes: number[];
  subtitleStreamIndexes: number[];
};

export type EncodeQueueItem = {
  clientId: string;
  jobId: string | null;
  media: MediaInfo;
  settings: EncodingSettings;
  trackSelection: TrackSelection;
  outputPath: string | null;
  status: EncodeJobStatus;
  progress: EncodeProgress;
  error: string | null;
  diagnostic: DiagnosticReport | null;
};

export type HistoryStatus = "completed" | "failed" | "cancelled";

export type HistoryEntry = {
  id: string;
  sourcePath: string;
  sourceName: string;
  outputPath: string;
  status: HistoryStatus;
  startedAtMs: number;
  finishedAtMs: number;
  mediaDurationSeconds: number;
  sourceSizeBytes: number;
  outputSizeBytes: number | null;
  settings: EncodingSettings;
  error: string | null;
  diagnostic: DiagnosticReport | null;
};

export type ApiError = {
  code?: string;
  message?: string;
};
