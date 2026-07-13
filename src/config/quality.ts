export const QUALITY_LEVELS = [
  {
    id: "maximum-compression",
    label: "Maximum compression",
    description: "Smallest files, best for sharing",
    crf: { h264: 30, h265: 34 },
  },
  {
    id: "smaller-file",
    label: "Smaller file",
    description: "Strong compression with good quality",
    crf: { h264: 26, h265: 30 },
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Great quality at a practical size",
    crf: { h264: 22, h265: 26 },
  },
  {
    id: "high-quality",
    label: "High quality",
    description: "More detail with a larger output",
    crf: { h264: 19, h265: 23 },
  },
  {
    id: "near-source",
    label: "Near source",
    description: "Maximum detail, largest file",
    crf: { h264: 17, h265: 21 },
  },
] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export function qualityLevel(id: QualityLevel["id"]): QualityLevel {
  return QUALITY_LEVELS.find((quality) => quality.id === id) ?? QUALITY_LEVELS[2];
}
