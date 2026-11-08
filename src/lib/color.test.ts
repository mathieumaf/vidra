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
  it("blocks H.264 when an HDR transfer cannot be established", () => {
    const unknown = video({ hdrFormat: "hdr", colorTransfer: null });
    expect(colorConversionNotice(unknown, "h264")).toMatchObject({ blocking: true });
    expect(colorConversionNotice(unknown, "copy")).toMatchObject({ blocking: false });
    for (const colorTransfer of ["smpte2084", "arib-std-b67"]) {
      expect(colorConversionNotice({ ...unknown, colorTransfer }, "h264")?.blocking).toBe(false);
    }
    for (const hdrFormat of ["hdr10", "hdr10-plus", "pq", "hlg"] as const) {
      expect(colorConversionNotice({ ...unknown, hdrFormat }, "h264")?.blocking).toBe(false);
    }
  });

  it("describes the actual SDR output depth of each encoder", () => {
    const source = video({ hdrFormat: null, colorPrimaries: "bt709", colorTransfer: "bt709" });
    expect(colorConversionNotice(source, "h264")?.message).toContain("reduced to 8-bit");
    for (const codec of ["h265", "av1"] as const) {
      expect(colorConversionNotice(source, codec)?.message).toContain("encoded as 10-bit");
      expect(colorConversionNotice({ ...source, bitDepth: 12 }, codec)?.message).toContain("reduced to 10-bit");
    }
  });

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
