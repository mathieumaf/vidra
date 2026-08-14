// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentRuntimeFailure,
  dismissRuntimeFailure,
  installGlobalFailureHandlers,
  resetRuntimeFailures,
  subscribeToRuntimeFailures,
} from "./runtimeFailures";

function rejectionEvent(reason: unknown): Event {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  return event;
}

afterEach(() => {
  resetRuntimeFailures();
});

describe("global failure handlers", () => {
  it("reports uncaught errors with a diagnostic report", () => {
    installGlobalFailureHandlers();

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("handler exploded") }));

    const failure = currentRuntimeFailure();
    expect(failure?.message).toBe("handler exploded");
    expect(failure?.diagnostic.code).toBe("interface_uncaught_error");
    expect(failure?.diagnostic.report).toContain("Message: handler exploded");
  });

  it("reports unhandled promise rejections", () => {
    installGlobalFailureHandlers();

    window.dispatchEvent(rejectionEvent(new Error("probe never resolved")));

    expect(currentRuntimeFailure()?.diagnostic.code).toBe("interface_unhandled_rejection");
    expect(currentRuntimeFailure()?.message).toBe("probe never resolved");
  });

  it("ignores failed resource loads that carry no error detail", () => {
    installGlobalFailureHandlers();

    window.dispatchEvent(new ErrorEvent("error", {}));

    expect(currentRuntimeFailure()).toBeNull();
  });

  it("groups repeated identical failures and notifies subscribers", () => {
    installGlobalFailureHandlers();
    const listener = vi.fn();
    subscribeToRuntimeFailures(listener);

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("same failure") }));
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("same failure") }));

    expect(currentRuntimeFailure()?.occurrences).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clears the failure when the user dismisses it", () => {
    installGlobalFailureHandlers();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("dismiss me") }));

    dismissRuntimeFailure();

    expect(currentRuntimeFailure()).toBeNull();
  });

  it("stops reporting once the handlers are removed", () => {
    const uninstall = installGlobalFailureHandlers();
    uninstall();
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("error", swallow);

    try {
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("after removal") }));

      expect(currentRuntimeFailure()).toBeNull();
    } finally {
      window.removeEventListener("error", swallow);
    }
  });
});
