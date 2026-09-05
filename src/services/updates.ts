import { invoke } from "@tauri-apps/api/core";
import type { AvailableApplicationUpdate, UpdateChannel } from "../types/applicationUpdate";

export function checkForApplicationUpdate(
  channel: UpdateChannel,
): Promise<AvailableApplicationUpdate | null> {
  return invoke("check_application_update", { channel });
}

export function installApplicationUpdate(expectedVersion: string, channel: UpdateChannel): Promise<void> {
  return invoke("install_application_update", { expectedVersion, channel });
}
