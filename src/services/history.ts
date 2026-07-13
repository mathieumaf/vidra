import { invoke } from "@tauri-apps/api/core";
import type { HistoryEntry } from "../types/media";

export function listConversionHistory(): Promise<HistoryEntry[]> {
  return invoke("list_conversion_history");
}

export function deleteHistoryEntry(id: string): Promise<void> {
  return invoke("delete_history_entry", { id });
}

export function clearConversionHistory(): Promise<void> {
  return invoke("clear_conversion_history");
}

export function revealHistoryOutput(id: string): Promise<void> {
  return invoke("reveal_history_output", { id });
}
