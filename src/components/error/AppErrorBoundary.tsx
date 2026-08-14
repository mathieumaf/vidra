import { Component, type ErrorInfo, type ReactNode } from "react";
import { failureDiagnostic } from "../../lib/failure";
import { errorMessage } from "../../lib/format";
import type { DiagnosticReport } from "../../types/media";

export type BoundaryFailure = {
  diagnostic: DiagnosticReport;
  message: string;
  /** How many times this boundary caught a failure, so repeated failures can be explained. */
  attempts: number;
  retry: () => void;
};

type CaughtFailure = {
  error: unknown;
  componentStack: string | null;
  capturedAtMs: number;
};

type AppErrorBoundaryProps = {
  children: ReactNode;
  renderFallback: (failure: BoundaryFailure) => ReactNode;
  /** Clears the failure when the surrounding context changes, such as the active view. */
  resetKey?: string;
};

type AppErrorBoundaryState = {
  failure: CaughtFailure | null;
  attempts: number;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failure: null, attempts: 0 };

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { failure: { error, componentStack: null, capturedAtMs: Date.now() } };
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    this.setState((previous) => ({
      failure: previous.failure
        ? { ...previous.failure, componentStack: info.componentStack ?? null }
        : previous.failure,
      attempts: previous.attempts + 1,
    }));
  }

  componentDidUpdate(previous: AppErrorBoundaryProps) {
    if (this.state.failure && previous.resetKey !== this.props.resetKey) this.retry();
  }

  retry = () => {
    this.setState({ failure: null });
  };

  render() {
    const { failure, attempts } = this.state;
    if (!failure) return this.props.children;

    return this.props.renderFallback({
      diagnostic: failureDiagnostic({
        source: "render",
        error: failure.error,
        componentStack: failure.componentStack,
        capturedAtMs: failure.capturedAtMs,
      }),
      message: errorMessage(failure.error),
      attempts,
      retry: this.retry,
    });
  }
}
