import type { OutputResolution, VideoStream } from "../types/media";

type ResolutionOption = {
  id: OutputResolution;
  label: string;
  description: string;
  landscapeBounds: readonly [width: number, height: number] | null;
};

export const OUTPUT_RESOLUTIONS: ReadonlyArray<ResolutionOption> = [
  { id: "source", label: "Original", description: "Source size", landscapeBounds: null },
  { id: "2160p", label: "4K", description: "2160p", landscapeBounds: [3840, 2160] },
  { id: "1440p", label: "1440p", description: "QHD", landscapeBounds: [2560, 1440] },
  { id: "1080p", label: "1080p", description: "Full HD", landscapeBounds: [1920, 1080] },
  { id: "720p", label: "720p", description: "HD", landscapeBounds: [1280, 720] },
  { id: "480p", label: "480p", description: "SD", landscapeBounds: [854, 480] },
  { id: "360p", label: "360p", description: "Compact", landscapeBounds: [640, 360] },
];

export function outputResolution(resolution: OutputResolution): ResolutionOption {
  return OUTPUT_RESOLUTIONS.find((option) => option.id === resolution) ?? OUTPUT_RESOLUTIONS[0];
}

export function outputResolutionLabel(resolution: OutputResolution): string {
  return outputResolution(resolution).label;
}

export function outputDimensions(
  video: VideoStream | null,
  resolution: OutputResolution,
): { width: number; height: number } | null {
  if (!video || video.width === 0 || video.height === 0) return null;
  const bounds = outputResolution(resolution).landscapeBounds;
  if (!bounds) return { width: video.width, height: video.height };

  const [landscapeWidth, landscapeHeight] = bounds;
  const [maximumWidth, maximumHeight] = video.width >= video.height
    ? [landscapeWidth, landscapeHeight]
    : [landscapeHeight, landscapeWidth];
  const scale = Math.min(1, maximumWidth / video.width, maximumHeight / video.height);
  if (scale === 1) return { width: video.width, height: video.height };

  return {
    width: Math.max(2, Math.floor((video.width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((video.height * scale) / 2) * 2),
  };
}

export function resolutionReducesVideo(
  video: VideoStream | null,
  resolution: OutputResolution,
): boolean {
  const dimensions = outputDimensions(video, resolution);
  return dimensions !== null
    && (dimensions.width < video!.width || dimensions.height < video!.height);
}
