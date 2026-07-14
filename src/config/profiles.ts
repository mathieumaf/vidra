import { DEFAULT_ADVANCED_SETTINGS, frameRateReducesVideo } from "./advanced";
import { canCopyAudioToMp4, canCopyVideoToMp4 } from "./encoding";
import { resolutionReducesVideo } from "./resolution";
import type { EncodingSettings, MediaInfo } from "../types/media";

export type EncodingProfile = {
  id: string;
  name: string;
  description: string | null;
  settings: EncodingSettings;
  isAdvanced: boolean;
  isBuiltIn: boolean;
};

export type UserEncodingProfile = Omit<EncodingProfile, "description" | "isBuiltIn">;

const BASE_SETTINGS: EncodingSettings = {
  quality: "balanced",
  container: "mp4",
  videoCodec: "h264",
  encodingSpeed: "efficient",
  audioMode: "auto",
  outputResolution: "source",
  ...DEFAULT_ADVANCED_SETTINGS,
};

export const BUILT_IN_PROFILES: ReadonlyArray<EncodingProfile> = [
  {
    id: "built-in-balanced",
    name: "Balanced",
    description: "Reliable H.264 MP4 with a practical size",
    settings: BASE_SETTINGS,
    isAdvanced: false,
    isBuiltIn: true,
  },
  {
    id: "built-in-smaller-file",
    name: "Smaller file",
    description: "Efficient H.265 MP4 for reduced file sizes",
    settings: {
      ...BASE_SETTINGS,
      quality: "smaller-file",
      videoCodec: "h265",
    },
    isAdvanced: false,
    isBuiltIn: true,
  },
  {
    id: "built-in-fast-export",
    name: "Fast export",
    description: "Hardware-accelerated H.264 MP4",
    settings: {
      ...BASE_SETTINGS,
      encodingSpeed: "fast",
    },
    isAdvanced: false,
    isBuiltIn: true,
  },
];

const settingKeys = [
  "quality",
  "container",
  "videoCodec",
  "encodingSpeed",
  "audioMode",
  "outputResolution",
  "outputFrameRate",
  "qualityTuning",
  "audioBitrate",
  "audioChannels",
  "audioTrackMode",
  "preserveSubtitles",
  "preserveMetadata",
  "preserveChapters",
] as const satisfies ReadonlyArray<keyof EncodingSettings>;

const validValues = {
  quality: new Set(["maximum-compression", "smaller-file", "balanced", "high-quality", "near-source"]),
  container: new Set(["mp4", "mkv"]),
  videoCodec: new Set(["copy", "h264", "h265", "av1"]),
  encodingSpeed: new Set(["efficient", "fast"]),
  audioMode: new Set(["auto", "copy", "aac", "opus", "none"]),
  outputResolution: new Set(["source", "2160p", "1440p", "1080p", "720p", "480p", "360p"]),
  outputFrameRate: new Set(["source", "24", "25", "30", "50", "60"]),
  audioBitrate: new Set(["auto", "96", "128", "160", "192", "256"]),
  audioChannels: new Set(["source", "stereo", "mono"]),
  audioTrackMode: new Set(["all", "first"]),
};

export function encodingSettingsEqual(left: EncodingSettings, right: EncodingSettings): boolean {
  return settingKeys.every((key) => left[key] === right[key]);
}

export function compatibleProfileSettings(
  settings: EncodingSettings,
  media: MediaInfo | null,
): EncodingSettings {
  let next = { ...settings };
  if (next.videoCodec === "av1" || next.audioMode === "opus") {
    next.container = "mkv";
  }
  if (next.videoCodec === "av1" || next.videoCodec === "copy") {
    next.encodingSpeed = "efficient";
  }
  if (
    next.outputResolution !== "source"
    && !resolutionReducesVideo(media?.video ?? null, next.outputResolution)
  ) {
    next.outputResolution = "source";
  }
  if (
    next.outputFrameRate !== "source"
    && !frameRateReducesVideo(media?.video ?? null, next.outputFrameRate)
  ) {
    next.outputFrameRate = "source";
  }
  if (next.videoCodec === "copy") {
    next.outputResolution = "source";
    next.outputFrameRate = "source";
    next.qualityTuning = 0;
    if (next.container === "mp4" && !canCopyVideoToMp4(media?.video ?? null)) {
      next.videoCodec = "h264";
      next.encodingSpeed = "efficient";
    }
  }
  if (next.audioMode === "auto" || next.audioMode === "copy") {
    next.audioBitrate = "auto";
    next.audioChannels = "source";
  }
  if (
    next.audioMode === "copy"
    && next.container === "mp4"
    && !canCopyAudioToMp4(media?.audio ?? [])
  ) {
    next.audioMode = "auto";
  }
  return next;
}

export function parseStoredProfiles(value: string | null): UserEncodingProfile[] {
  if (!value) return [];
  try {
    const document = JSON.parse(value) as unknown;
    if (!isRecord(document) || document.version !== 1 || !Array.isArray(document.profiles)) return [];
    const seenIds = new Set<string>();
    return document.profiles.flatMap((candidate) => {
      if (!isUserProfile(candidate) || seenIds.has(candidate.id)) return [];
      seenIds.add(candidate.id);
      return [{
        id: candidate.id,
        name: candidate.name.trim().slice(0, 60),
        settings: { ...candidate.settings },
        isAdvanced: candidate.isAdvanced,
      }];
    });
  } catch {
    return [];
  }
}

export function serializeProfiles(profiles: UserEncodingProfile[]): string {
  return JSON.stringify({ version: 1, profiles });
}

function isUserProfile(value: unknown): value is UserEncodingProfile {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.startsWith("user-")
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.isAdvanced === "boolean"
    && isEncodingSettings(value.settings);
}

function isEncodingSettings(value: unknown): value is EncodingSettings {
  if (!isRecord(value)) return false;
  return validValues.quality.has(String(value.quality))
    && validValues.container.has(String(value.container))
    && validValues.videoCodec.has(String(value.videoCodec))
    && validValues.encodingSpeed.has(String(value.encodingSpeed))
    && validValues.audioMode.has(String(value.audioMode))
    && validValues.outputResolution.has(String(value.outputResolution))
    && validValues.outputFrameRate.has(String(value.outputFrameRate))
    && Number.isInteger(value.qualityTuning)
    && Number(value.qualityTuning) >= -2
    && Number(value.qualityTuning) <= 2
    && validValues.audioBitrate.has(String(value.audioBitrate))
    && validValues.audioChannels.has(String(value.audioChannels))
    && validValues.audioTrackMode.has(String(value.audioTrackMode))
    && typeof value.preserveSubtitles === "boolean"
    && typeof value.preserveMetadata === "boolean"
    && typeof value.preserveChapters === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
