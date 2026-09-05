import type { UpdateChannel } from "../types/applicationUpdate";

export const UPDATE_CHANNEL_STORAGE_KEY = "vidra.update-channel";

export function readUpdateChannel(): UpdateChannel {
  try {
    return localStorage.getItem(UPDATE_CHANNEL_STORAGE_KEY) === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}

export function storeUpdateChannel(channel: UpdateChannel) {
  try {
    localStorage.setItem(UPDATE_CHANNEL_STORAGE_KEY, channel);
  } catch {
    // Keep the selected channel for this session when storage is unavailable.
  }
}
