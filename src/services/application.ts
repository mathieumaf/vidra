import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

export function getApplicationVersion(): Promise<string> {
  return getVersion();
}

export function openExternalUrl(url: string): Promise<void> {
  return openUrl(url);
}
