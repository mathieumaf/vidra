export const QUALITY_LEVELS = [
  {
    id: "maximum-compression",
    label: "Maximum compression",
    description: "Smallest files, best for sharing",
  },
  {
    id: "smaller-file",
    label: "Smaller file",
    description: "Strong compression with good quality",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Great quality at a practical size",
  },
  {
    id: "high-quality",
    label: "High quality",
    description: "More detail with a larger output",
  },
  {
    id: "near-source",
    label: "Near source",
    description: "Maximum detail, largest file",
  },
] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export function qualityLevel(id: QualityLevel["id"]): QualityLevel {
  return QUALITY_LEVELS.find((quality) => quality.id === id) ?? QUALITY_LEVELS[2];
}
