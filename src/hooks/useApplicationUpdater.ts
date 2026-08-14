import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import {
  checkForApplicationUpdate,
  installApplicationUpdate,
  type AvailableApplicationUpdate,
} from "../services/updates";

export type ApplicationUpdaterState = {
  phase: "idle" | "checking" | "up-to-date" | "available" | "installing" | "error";
  update: AvailableApplicationUpdate | null;
  error: string | null;
};

const INITIAL_STATE: ApplicationUpdaterState = {
  phase: "idle",
  update: null,
  error: null,
};

export function useApplicationUpdater() {
  const [state, setState] = useState(INITIAL_STATE);
  const checkId = useRef(0);

  const checkForUpdates = useCallback(async () => {
    const currentCheck = ++checkId.current;
    setState((current) => ({ ...current, phase: "checking", error: null }));
    try {
      const update = await checkForApplicationUpdate();
      if (currentCheck !== checkId.current) return;
      setState({
        phase: update ? "available" : "up-to-date",
        update,
        error: null,
      });
    } catch (cause) {
      if (currentCheck !== checkId.current) return;
      setState({
        phase: "error",
        update: null,
        error: `Vidra could not check for updates: ${errorMessage(cause)}`,
      });
    }
  }, []);

  useEffect(() => {
    if (__VIDRA_RELEASE_TAG__ !== null) void checkForUpdates();
    return () => {
      checkId.current += 1;
    };
  }, [checkForUpdates]);

  const installUpdate = useCallback(async () => {
    if (!state.update || state.phase === "installing") return;
    setState((current) => ({ ...current, phase: "installing", error: null }));
    try {
      await installApplicationUpdate(state.update.version);
    } catch (cause) {
      setState((current) => ({
        ...current,
        phase: "error",
        error: `Vidra could not install the update: ${errorMessage(cause)}`,
      }));
    }
  }, [state.phase, state.update]);

  return { state, checkForUpdates, installUpdate };
}
