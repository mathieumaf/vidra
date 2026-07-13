import type { ApiError } from "../types/media";

export function formatBytes(bytes: number): string {
  if (!bytes) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function formatBitrate(bitsPerSecond: number | null): string {
  if (!bitsPerSecond) return "unknown bitrate";
  return `${Math.round(bitsPerSecond / 1000)} kb/s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown duration";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiError).message);
  }
  return "Something went wrong. Please try again.";
}

export function defaultOutputPath(inputPath: string): string {
  const extensionIndex = inputPath.lastIndexOf(".");
  const separatorIndex = Math.max(inputPath.lastIndexOf("/"), inputPath.lastIndexOf("\\"));
  const base = extensionIndex > separatorIndex ? inputPath.slice(0, extensionIndex) : inputPath;
  return `${base}-vidra.mp4`;
}
