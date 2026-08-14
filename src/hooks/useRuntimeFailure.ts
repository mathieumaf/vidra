import { useSyncExternalStore } from "react";
import {
  currentRuntimeFailure,
  dismissRuntimeFailure,
  subscribeToRuntimeFailures,
  type RuntimeFailure,
} from "../lib/runtimeFailures";

export function useRuntimeFailure(): {
  failure: RuntimeFailure | null;
  dismiss: () => void;
} {
  const failure = useSyncExternalStore(subscribeToRuntimeFailures, currentRuntimeFailure);

  return { failure, dismiss: dismissRuntimeFailure };
}
