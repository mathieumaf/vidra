import type { OutputContainer, VideoCodec } from "../types/media";

export const OUTPUT_CONTAINERS: ReadonlyArray<{
  id: OutputContainer;
  label: string;
  description: string;
  extension: string;
  filterName: string;
}> = [
  {
    id: "mp4",
    label: "MP4",
    description: "Broad compatibility",
    extension: "mp4",
    filterName: "MPEG-4 video",
  },
  {
    id: "mkv",
    label: "MKV",
    description: "Flexible tracks",
    extension: "mkv",
    filterName: "Matroska video",
  },
];

export const VIDEO_CODECS: ReadonlyArray<{
  id: VideoCodec;
  label: string;
  description: string;
}> = [
  { id: "h264", label: "H.264", description: "Best compatibility" },
  { id: "h265", label: "H.265", description: "Smaller files" },
];

export function outputContainer(container: OutputContainer) {
  return OUTPUT_CONTAINERS.find((option) => option.id === container) ?? OUTPUT_CONTAINERS[0];
}

export function videoCodec(codec: VideoCodec) {
  return VIDEO_CODECS.find((option) => option.id === codec) ?? VIDEO_CODECS[0];
}
