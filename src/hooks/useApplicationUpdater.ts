import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import { readUpdateChannel, storeUpdateChannel } from "../lib/updateChannel";
import type { AvailableApplicationUpdate, UpdateChannel } from "../types/applicationUpdate";
import {
  checkForApplicationUpdate,
  installApplicationUpdate,
} from "../services/updates";

export type ApplicationUpdaterState = {
  channel: UpdateChannel;
  phase: "idle" | "checking" | "up-to-date" | "available" | "installing" | "error";
  update: AvailableApplicationUpdate | null;
  error: string | null;
};

export function useApplicationUpdater(checkOnStartup = __VIDRA_RELEASE_TAG__ !== null) {
  const [state, setState] = useState<ApplicationUpdaterState>(() => ({
    channel: readUpdateChannel(),
    phase: "idle",
    update: null,
    error: null,
  }));
  const stateRef = useRef(state);
  const checkId = useRef(0);

  const updateState = useCallback((next: ApplicationUpdaterState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (stateRef.current.phase === "installing") return;
    const { channel } = stateRef.current;
    const currentCheck = ++checkId.current;
    updateState({ channel, phase: "checking", update: null, error: null });
    try {
      const update = await checkForApplicationUpdate(channel);
      if (currentCheck !== checkId.current) return;
      updateState({
        channel,
        phase: update ? "available" : "up-to-date",
        update,
        error: null,
      });
    } catch (cause) {
      if (currentCheck !== checkId.current) return;
      updateState({
        channel,
        phase: "error",
        update: null,
        error: `Vidra could not check for updates: ${errorMessage(cause)}`,
      });
    }
  }, [updateState]);

  const setChannel = useCallback((channel: UpdateChannel) => {
    if (stateRef.current.phase === "installing" || stateRef.current.channel === channel) return;
    checkId.current += 1;
    storeUpdateChannel(channel);
    updateState({ channel, phase: "idle", update: null, error: null });
    void checkForUpdates();
  }, [checkForUpdates, updateState]);

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
      await installApplicationUpdate(current.update.version, current.channel);
    } catch (cause) {
      if (installationId !== checkId.current) return;
      updateState({
        ...current,
        phase: "error",
        error: `Vidra could not install the update: ${errorMessage(cause)}`,
      });
    }
  }, [updateState]);

  return { state, setChannel, checkForUpdates, installUpdate };
}
