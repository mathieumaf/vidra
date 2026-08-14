import { describe, expect, it } from "vitest";
import { conversionActivity } from "./conversionActivity";
import { failureDiagnostic, type FailureEnvironment } from "./failure";
import { clearQueueSession, rememberQueueItems } from "./queueSession";
import { encodingItemFixture } from "../test/fixtures";

const environment: FailureEnvironment = {
  appVersion: "0.1.0",
  platform: "MacIntel",
  language: "en-US",
  userAgent: "Vidra test webview",
};

function diagnostic(error: unknown, componentStack: string | null = null) {
  return failureDiagnostic({
    source: "render",
    error,
    componentStack,
    capturedAtMs: Date.UTC(2026, 7, 14, 12, 0, 0),
    activity: conversionActivity([encodingItemFixture("holiday.mov")]),
    environment,
  });
}

describe("failureDiagnostic", () => {
  it("builds an actionable report for a render failure", () => {
    const error = new TypeError("Cannot read properties of undefined");
    error.stack = "TypeError: Cannot read properties of undefined\n    at QueueView (/app/src/components/views/QueueView.tsx:12:3)";

    const report = diagnostic(error, "\n    at QueueView\n    at App");

    expect(report.code).toBe("interface_render_error");
    expect(report.summary).toContain("stopped drawing");
    expect(report.report).toContain("Vidra diagnostic report");
    expect(report.report).toContain("Code: interface_render_error");
    expect(report.report).toContain("Reported: 2026-08-14T12:00:00.000Z");
    expect(report.report).toContain("Vidra: 0.1.0");
    expect(report.report).toContain("Webview: Vidra test webview");
    expect(report.report).toContain("Name: TypeError");
    expect(report.report).toContain("Message: Cannot read properties of undefined");
    expect(report.report).toContain("at QueueView (/app/src/components/views/QueueView.tsx:12:3)");
    expect(report.report).toContain("Component stack");
    expect(report.report).toContain("Encoding: 1");
  });

  it("uses a distinct code for each failure source", () => {
    const error = new Error("boom");

    expect(failureDiagnostic({ source: "uncaught-error", error, environment }).code)
      .toBe("interface_uncaught_error");
    expect(failureDiagnostic({ source: "unhandled-rejection", error, environment }).code)
      .toBe("interface_unhandled_rejection");
  });

  it("redacts home folder paths and never names the media", () => {
    const error = new Error("failed");
    error.stack = [
      "Error: failed",
      "    at render (/Users/casey/Library/Vidra/app.js:2:1)",
      "    at load (/home/casey/vidra/app.js:3:1)",
      "    at boot (C:\\Users\\casey\\Vidra\\app.js:4:1)",
    ].join("\n");

    const report = diagnostic(error).report;

    expect(report).toContain("/Users/<user>/Library/Vidra/app.js");
    expect(report).toContain("/home/<user>/vidra/app.js");
    expect(report).toContain("C:\\Users\\<user>\\Vidra\\app.js");
    expect(report).not.toContain("casey");
    expect(report).not.toContain("holiday.mov");
  });

  it("handles thrown values that are not errors", () => {
    const report = diagnostic("something odd happened").report;

    expect(report).toContain("Name: String");
    expect(report).toContain("Message: something odd happened");
    expect(report).toContain("No stack was captured.");
    expect(report).toContain("No component stack was captured.");
  });

  it("stays small enough for the report the engine can save", () => {
    const error = new Error("boom");
    error.stack = "x".repeat(200_000);

    const report = diagnostic(error, "y".repeat(200_000)).report;

    expect(report.length).toBeLessThanOrEqual(48 * 1024);
    expect(report).toContain("[Remaining frames omitted.]");
  });

  it("falls back to the remembered queue when no activity is provided", () => {
    rememberQueueItems([encodingItemFixture()]);

    try {
      const report = failureDiagnostic({ source: "render", error: new Error("boom"), environment });

      expect(report.report).toContain("Encoding: 1");
    } finally {
      clearQueueSession();
    }
  });
});
