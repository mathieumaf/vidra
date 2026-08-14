import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";

export type AvailableApplicationUpdate = {
  currentVersion: string;
  version: string;
  date: string | null;
  notes: string | null;
};

export async function checkForApplicationUpdate(): Promise<AvailableApplicationUpdate | null> {
  const update = await check();
  if (!update) return null;

  try {
    return {
      currentVersion: update.currentVersion,
      version: update.version,
      date: update.date ?? null,
      notes: update.body ?? null,
    };
  } finally {
    await update.close();
  }
}

export function installApplicationUpdate(expectedVersion: string): Promise<void> {
  return invoke("install_application_update", { expectedVersion });
}
