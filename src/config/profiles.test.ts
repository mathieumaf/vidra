import { describe, expect, it } from "vitest";
import { BUILT_IN_PROFILES, compatibleProfileSettings, parseStoredProfiles, serializeProfiles } from "./profiles";
import type { MediaInfo } from "../types/media";

const smallMedia: MediaInfo = {
  path: "/tmp/source.mp4",
  name: "source.mp4",
  durationSeconds: 10,
  sizeBytes: 100,
  formatName: "mov,mp4",
  formatLongName: "QuickTime / MOV",
  video: {
    codec: "h264",
    width: 640,
    height: 360,
    frameRate: 30,
    pixelFormat: "yuv420p",
    bitDepth: 8,
    colorRange: "tv",
    colorSpace: "bt709",
    colorTransfer: "bt709",
    colorPrimaries: "bt709",
    hdrFormat: null,
  },
  audio: [],
  subtitles: [],
  chapterCount: 0,
  hasMetadata: false,
};

describe("encoding profiles", () => {
  it("round-trips valid personal profiles", () => {
    const profile = {
      id: "user-test",
      name: "My profile",
      settings: { ...BUILT_IN_PROFILES[0].settings },
      isAdvanced: false,
    };

    expect(parseStoredProfiles(serializeProfiles([profile]))).toEqual([profile]);
  });

  it("rejects malformed stored data", () => {
    expect(parseStoredProfiles("not json")).toEqual([]);
    expect(parseStoredProfiles(JSON.stringify({ version: 2, profiles: [] }))).toEqual([]);
    expect(parseStoredProfiles(JSON.stringify({
      version: 1,
      profiles: [{ id: "built-in-forged", name: "Forged", settings: {}, isAdvanced: false }],
    }))).toEqual([]);
  });

  it("never upscales or raises the frame rate when applying a profile", () => {
    const settings = {
      ...BUILT_IN_PROFILES[0].settings,
      outputResolution: "1080p" as const,
      outputFrameRate: "60" as const,
    };

    expect(compatibleProfileSettings(settings, smallMedia)).toMatchObject({
      outputResolution: "source",
      outputFrameRate: "source",
    });
  });
});
