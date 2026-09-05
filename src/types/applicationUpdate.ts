export type UpdateChannel = "stable" | "beta";

export type AvailableApplicationUpdate = {
  currentVersion: string;
  version: string;
  date: string | null;
  notes: string | null;
};
