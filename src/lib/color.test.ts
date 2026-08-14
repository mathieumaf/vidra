import { describe, expect, it } from "vitest";
import { colorConversionNotice } from "./color";
import type { VideoStream } from "../types/media";

function video(overrides: Partial<VideoStream> = {}): VideoStream {
  return {
    codec: "hevc",
    width: 3840,
    height: 2160,
    frameRate: 30,
    pixelFormat: "yuv420p10le",
    bitDepth: 10,
    colorRange: "tv",
    colorSpace: "bt2020nc",
    colorTransfer: "arib-std-b67",
    colorPrimaries: "bt2020",
    hdrFormat: "hlg",
    dolbyVision: null,
    ...overrides,
  };
}

describe("color conversion notices", () => {
  it("explains automatic HDR handling for every codec path", () => {
    expect(colorConversionNotice(video(), "h264")).toMatchObject({
      title: "HLG will be converted to SDR",
      blocking: false,
    });
    expect(colorConversionNotice(video(), "h265")).toMatchObject({
      title: "HLG will stay HDR",
      blocking: false,
    });
    expect(colorConversionNotice(video(), "av1")).toMatchObject({
      title: "HLG will stay HDR",
      blocking: false,
    });
    expect(colorConversionNotice(video(), "copy")).toMatchObject({
      title: "HLG will be copied unchanged",
      blocking: false,
    });
  });

  it("blocks Dolby Vision without a compatible single-layer base", () => {
    const profile5 = video({
      hdrFormat: "dolby-vision",
      dolbyVision: {
        profile: 5,
        baseLayerCompatibilityId: 0,
        hasEnhancementLayer: false,
      },
    });

    expect(colorConversionNotice(profile5, "h265")).toMatchObject({
      title: "Dolby Vision profile 5 requires Original video",
      blocking: true,
    });
    expect(colorConversionNotice(profile5, "copy")?.blocking).toBe(false);

    const sdrBase = video({
      hdrFormat: "dolby-vision",
      dolbyVision: {
        profile: 8,
        baseLayerCompatibilityId: 2,
        hasEnhancementLayer: false,
      },
    });
    expect(colorConversionNotice(sdrBase, "h264")?.blocking).toBe(true);
  });

  it("uses the compatible HDR base of single-layer Dolby Vision", () => {
    const profile8 = video({
      hdrFormat: "dolby-vision",
      dolbyVision: {
        profile: 8,
        baseLayerCompatibilityId: 4,
        hasEnhancementLayer: false,
      },
    });

    expect(colorConversionNotice(profile8, "h264")).toMatchObject({
      title: "Dolby Vision will be converted to SDR",
      blocking: false,
    });
    expect(colorConversionNotice(profile8, "h265")).toMatchObject({
      title: "Dolby Vision will remain compatible HDR",
      blocking: false,
    });
  });
});
