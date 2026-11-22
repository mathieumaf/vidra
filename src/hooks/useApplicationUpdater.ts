import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import type { AvailableApplicationUpdate } from "../types/applicationUpdate";
import {
  checkForApplicationUpdate,
  installApplicationUpdate,
} from "../services/updates";

export type ApplicationUpdaterState = {
  phase: "idle" | "checking" | "up-to-date" | "available" | "installing" | "error";
  update: AvailableApplicationUpdate | null;
  error: string | null;
};

export function useApplicationUpdater(checkOnStartup = __VIDRA_OFFICIAL_BUILD__) {
  const [state, setState] = useState<ApplicationUpdaterState>({
    phase: "idle",
    update: null,
    error: null,
  });
  const stateRef = useRef(state);
  const checkId = useRef(0);

  const updateState = useCallback((next: ApplicationUpdaterState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (stateRef.current.phase === "installing") return;
    const currentCheck = ++checkId.current;
    updateState({ phase: "checking", update: null, error: null });
    try {
      const update = await checkForApplicationUpdate();
      if (currentCheck !== checkId.current) return;
      updateState({
        phase: update ? "available" : "up-to-date",
        update,
        error: null,
      });
    } catch (cause) {
      if (currentCheck !== checkId.current) return;
      updateState({
        phase: "error",
        update: null,
        error: `Vidra could not check for updates: ${errorMessage(cause)}`,
      });
    }
  }, [updateState]);

  useEffect(() => {
    if (checkOnStartup) void checkForUpdates();
    return () => {
      checkId.current += 1;
    };
  }, [checkForUpdates, checkOnStartup]);

  const installUpdate = useCallback(async () => {
    const current = stateRef.current;
    if (!current.update || (current.phase !== "available" && current.phase !== "error")) return;
    const installationId = ++checkId.current;
    updateState({ ...current, phase: "installing", error: null });
    try {
      await installApplicationUpdate(current.update.version);
    } catch (cause) {
      if (installationId !== checkId.current) return;
      updateState({
        ...current,
        phase: "error",
        error: `Vidra could not install the update: ${errorMessage(cause)}`,
      });
    }
  }, [updateState]);

  return { state, checkForUpdates, installUpdate };
}
