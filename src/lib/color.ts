import type { HdrFormat, VideoCodec, VideoStream } from "../types/media";

export type ColorConversionNotice = {
  title: string;
  message: string;
  blocking: boolean;
};

const hdrLabels: Record<HdrFormat, string> = {
  "dolby-vision": "Dolby Vision",
  "hdr10-plus": "HDR10+",
  hdr10: "HDR10",
  hlg: "HLG",
  pq: "HDR (PQ)",
  hdr: "HDR",
};

const primariesLabels: Record<string, string> = {
  bt709: "BT.709",
  bt2020: "BT.2020",
  bt470bg: "BT.470 BG",
  smpte170m: "SMPTE 170M",
  smpte240m: "SMPTE 240M",
  smpte431: "DCI-P3",
  smpte432: "Display P3",
  "jedec-p22": "JEDEC P22",
};

const transferLabels: Record<string, string> = {
  bt709: "BT.709",
  smpte2084: "PQ (ST 2084)",
  "arib-std-b67": "HLG",
  "iec61966-2-1": "sRGB",
  gamma22: "Gamma 2.2",
  gamma28: "Gamma 2.8",
  linear: "Linear",
};

const colorSpaceLabels: Record<string, string> = {
  bt709: "BT.709",
  bt2020nc: "BT.2020 NCL",
  bt2020c: "BT.2020 CL",
  smpte170m: "SMPTE 170M",
  smpte240m: "SMPTE 240M",
  fcc: "FCC",
  rgb: "RGB",
};

const rangeLabels: Record<string, string> = {
  tv: "Limited",
  mpeg: "Limited",
  pc: "Full",
  jpeg: "Full",
};

const wideGamutPrimaries = new Set(["bt2020", "smpte431", "smpte432", "jedec-p22"]);

export function hdrFormatLabel(format: HdrFormat): string {
  return hdrLabels[format];
}

export function bitDepthLabel(depth: number): string {
  return `${depth}-bit`;
}

export function colorPrimariesLabel(value: string): string {
  return primariesLabels[value.toLowerCase()] ?? technicalLabel(value);
}

export function colorTransferLabel(value: string): string {
  return transferLabels[value.toLowerCase()] ?? technicalLabel(value);
}

export function colorSpaceLabel(value: string): string {
  return colorSpaceLabels[value.toLowerCase()] ?? technicalLabel(value);
}

export function colorRangeLabel(value: string): string {
  return rangeLabels[value.toLowerCase()] ?? technicalLabel(value);
}

export function colorConversionNotice(
  video: VideoStream | null,
  codec: VideoCodec,
): ColorConversionNotice | null {
  if (!video) return null;

  if (video.hdrFormat) {
    const label = hdrFormatLabel(video.hdrFormat);
    if (codec === "copy") {
      return {
        title: `${label} will be copied unchanged`,
        message: "Original video keeps the encoded video stream and its HDR metadata without re-encoding.",
        blocking: false,
      };
    }
    if (video.hdrFormat === "dolby-vision" && !hasCompatibleDolbyVisionBase(video)) {
      const profile = video.dolbyVision?.profile;
      return {
        title: profile ? `Dolby Vision profile ${profile} requires Original video` : "This Dolby Vision source requires Original video",
        message: "Vidra cannot safely re-encode this Dolby Vision structure. Choose Original video to avoid incorrect brightness or color.",
        blocking: true,
      };
    }
    if (codec === "h264") {
      return {
        title: `${label} will be converted to SDR`,
        message: "Vidra will tone map the HDR image to standard BT.709 color for reliable playback on SDR displays.",
        blocking: false,
      };
    }
    if (video.hdrFormat === "dolby-vision") {
      return {
        title: "Dolby Vision will remain compatible HDR",
        message: "Vidra will preserve the compatible 10-bit HLG or HDR10 base. Choose Original video when exact Dolby Vision metadata must remain unchanged.",
        blocking: false,
      };
    }
    if (video.hdrFormat === "hdr10-plus") {
      return {
        title: "HDR10+ will stay HDR",
        message: "Vidra will preserve the 10-bit HDR image and static color tags. Original video is required to guarantee that dynamic scene metadata remains unchanged.",
        blocking: false,
      };
    }
    return {
      title: `${label} will stay HDR`,
      message: "Vidra will preserve the source transfer, color gamut, range, and 10-bit HDR output.",
      blocking: false,
    };
  }

  if (codec === "copy") return null;

  if (video.bitDepth !== null && video.bitDepth > 8) {
    return {
      title: `${bitDepthLabel(video.bitDepth)} source will be re-encoded`,
      message: "The selected encoder may reduce the source color depth and introduce banding. Choose Original video to preserve the video stream.",
      blocking: false,
    };
  }

  if (video.colorPrimaries && wideGamutPrimaries.has(video.colorPrimaries.toLowerCase())) {
    return {
      title: "Wide-gamut source will be re-encoded",
      message: "The selected encoder may change the source color gamut. Choose Original video to preserve the video stream.",
      blocking: false,
    };
  }

  return null;
}

export function hasCompatibleDolbyVisionBase(video: VideoStream): boolean {
  const info = video.dolbyVision;
  return info !== null
    && (info.baseLayerCompatibilityId === 1 || info.baseLayerCompatibilityId === 4)
    && !info.hasEnhancementLayer;
}

function technicalLabel(value: string): string {
  return value.split("_").join(" ").toUpperCase();
}
