import type { HdrFormat, VideoCodec, VideoStream } from "../types/media";

export type ColorConversionRisk = {
  title: string;
  message: string;
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

export function colorConversionRisk(
  video: VideoStream | null,
  codec: VideoCodec,
): ColorConversionRisk | null {
  if (!video || codec === "copy") return null;

  if (video.hdrFormat) {
    const label = hdrFormatLabel(video.hdrFormat);
    return {
      title: `${label} source will be re-encoded`,
      message: "Vidra cannot guarantee that HDR metadata and appearance will be preserved yet. Brightness and color may change. Choose Original video to preserve the video stream.",
    };
  }

  if (video.bitDepth !== null && video.bitDepth > 8) {
    return {
      title: `${bitDepthLabel(video.bitDepth)} source will be re-encoded`,
      message: "The selected encoder may reduce the source color depth and introduce banding. Choose Original video to preserve the video stream.",
    };
  }

  if (video.colorPrimaries && wideGamutPrimaries.has(video.colorPrimaries.toLowerCase())) {
    return {
      title: "Wide-gamut source will be re-encoded",
      message: "The selected encoder may change the source color gamut. Choose Original video to preserve the video stream.",
    };
  }

  return null;
}

function technicalLabel(value: string): string {
  return value.split("_").join(" ").toUpperCase();
}
