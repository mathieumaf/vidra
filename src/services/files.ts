import { invoke } from "@tauri-apps/api/core";

export function revealOutputFile(path: string): Promise<void> {
  return invoke("reveal_output_file", { path });
}

export function listDestinationFiles(directory: string): Promise<string[]> {
  return invoke("list_destination_files", { directory });
}
