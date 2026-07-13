export const QUALITY_LEVELS = [
  {
    id: "maximum-compression",
    label: "Maximum compression",
    description: "Smallest files, best for sharing",
    crf: 30,
  },
  {
    id: "smaller-file",
    label: "Smaller file",
    description: "Strong compression with good quality",
    crf: 26,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Great quality at a practical size",
    crf: 22,
  },
  {
    id: "high-quality",
    label: "High quality",
    description: "More detail with a larger output",
    crf: 19,
  },
  {
    id: "near-source",
    label: "Near source",
    description: "Maximum detail, largest file",
    crf: 17,
  },
] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];
