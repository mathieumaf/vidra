import { failureDiagnostic, type FailureSource } from "./failure";
import { errorMessage } from "./format";
import type { DiagnosticReport } from "../types/media";

export type RuntimeFailure = {
  id: number;
  source: FailureSource;
  message: string;
  occurrences: number;
  diagnostic: DiagnosticReport;
};

const listeners = new Set<() => void>();
let current: RuntimeFailure | null = null;
let failureCount = 0;
let uninstall: (() => void) | null = null;

/**
 * Captures failures that happen outside the React render path so they stay
 * visible instead of disappearing into the webview console.
 */
export function installGlobalFailureHandlers(target: Window = window): () => void {
  if (uninstall) return uninstall;

  function handleError(event: ErrorEvent) {
    const error = event.error ?? event.message;
    // Failed resource loads report no error detail and are not actionable here.
    if (!error) return;
    reportRuntimeFailure("uncaught-error", error);
  }

  function handleRejection(event: PromiseRejectionEvent) {
    reportRuntimeFailure("unhandled-rejection", event.reason);
  }

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleRejection);
  uninstall = () => {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleRejection);
    uninstall = null;
  };
  return uninstall;
}

export function reportRuntimeFailure(source: FailureSource, error: unknown): RuntimeFailure {
  const message = errorMessage(error);
  if (current && current.source === source && current.message === message) {
    current = { ...current, occurrences: current.occurrences + 1 };
  } else {
    failureCount += 1;
    current = {
      id: failureCount,
      source,
      message,
      occurrences: 1,
      diagnostic: failureDiagnostic({ source, error }),
    };
  }
  listeners.forEach((listener) => listener());
  return current;
}

export function currentRuntimeFailure(): RuntimeFailure | null {
  return current;
}

export function subscribeToRuntimeFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissRuntimeFailure(): void {
  if (!current) return;
  current = null;
  listeners.forEach((listener) => listener());
}

export function resetRuntimeFailures(): void {
  uninstall?.();
  current = null;
  failureCount = 0;
  listeners.clear();
}
