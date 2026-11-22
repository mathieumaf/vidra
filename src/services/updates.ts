import { invoke } from "@tauri-apps/api/core";
import type { AvailableApplicationUpdate } from "../types/applicationUpdate";

export function checkForApplicationUpdate(): Promise<AvailableApplicationUpdate | null> {
  return invoke("check_application_update");
}

export function installApplicationUpdate(expectedVersion: string): Promise<void> {
  return invoke("install_application_update", { expectedVersion });
}
