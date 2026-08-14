import {
  conversionActivity,
  conversionActivitySummary,
  type ConversionActivity,
} from "./conversionActivity";
import { errorMessage } from "./format";
import { rememberedQueueItems } from "./queueSession";
import type { DiagnosticReport } from "../types/media";

export type FailureSource = "render" | "uncaught-error" | "unhandled-rejection";

/** Base name used when the user saves an interface diagnostic report. */
export const INTERFACE_REPORT_NAME = "interface";

/** Kept below the report size the Rust save command accepts. */
const MAX_REPORT_LENGTH = 40_000;
const MAX_STACK_LENGTH = 6_000;

const FAILURES: Record<FailureSource, { code: string; summary: string }> = {
  render: {
    code: "interface_render_error",
    summary: "The Vidra interface stopped drawing part of the window.",
  },
  "uncaught-error": {
    code: "interface_uncaught_error",
    summary: "An interface error was reported outside the conversion engine.",
  },
  "unhandled-rejection": {
    code: "interface_unhandled_rejection",
    summary: "An interface task failed without handling the failure.",
  },
};

export type FailureEnvironment = {
  appVersion: string;
  platform: string;
  language: string;
  userAgent: string;
};

export type FailureInput = {
  source: FailureSource;
  error: unknown;
  componentStack?: string | null;
  capturedAtMs?: number;
  activity?: ConversionActivity;
  environment?: FailureEnvironment;
};

export function failureEnvironment(): FailureEnvironment {
  const client = typeof navigator === "undefined" ? null : navigator;
  return {
    appVersion: typeof __VIDRA_VERSION__ === "string" ? __VIDRA_VERSION__ : "unknown",
    platform: client?.platform ?? "unknown",
    language: client?.language ?? "unknown",
    userAgent: client?.userAgent ?? "unknown",
  };
}

/**
 * Builds a diagnostic report for an interface failure. The shape mirrors the
 * report the conversion engine produces so both can use the same presentation.
 */
export function failureDiagnostic({
  source,
  error,
  componentStack = null,
  capturedAtMs = Date.now(),
  activity = conversionActivity(rememberedQueueItems()),
  environment = failureEnvironment(),
}: FailureInput): DiagnosticReport {
  const { code, summary } = FAILURES[source];
  const report = [
    "Vidra diagnostic report",
    "Privacy: file paths are redacted. Review the report before sharing it.",
    "",
    "Failure",
    `Code: ${code}`,
    `Summary: ${summary}`,
    `Reported: ${reportedAt(capturedAtMs)}`,
    "",
    "Environment",
    `Vidra: ${environment.appVersion}`,
    `Platform: ${environment.platform}`,
    `Language: ${environment.language}`,
    `Webview: ${environment.userAgent}`,
    "",
    "Conversions",
    conversionActivitySummary(activity),
    "",
    "Error",
    `Name: ${errorName(error)}`,
    `Message: ${errorMessage(error)}`,
    "",
    "Stack",
    section(errorStack(error), "No stack was captured."),
    "",
    "Component stack",
    section(componentStack, "No component stack was captured."),
  ].join("\n");

  return { code, summary, report: truncateReport(report) };
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  if (typeof error === "string") return "String";
  return error === null ? "null" : typeof error;
}

function errorStack(error: unknown): string | null {
  return error instanceof Error ? error.stack ?? null : null;
}

function section(value: string | null, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed ? redactPaths(boundedStack(trimmed)) : fallback;
}

function redactPaths(value: string): string {
  return value
    .replace(/(\/Users\/|\/home\/)[^/\s"'()[\]]+/g, "$1<user>")
    .replace(/(\\Users\\)[^\\\s"'()[\]]+/g, "$1<user>");
}

function boundedStack(value: string): string {
  if (value.length <= MAX_STACK_LENGTH) return value;
  return `${value.slice(0, MAX_STACK_LENGTH)}\n[Remaining frames omitted.]`;
}

function truncateReport(report: string): string {
  const notice = "\n[Diagnostic report truncated.]\n";
  if (report.length <= MAX_REPORT_LENGTH) return report;
  return `${report.slice(0, MAX_REPORT_LENGTH - notice.length)}${notice}`;
}

function reportedAt(capturedAtMs: number): string {
  const captured = new Date(capturedAtMs);
  return Number.isNaN(captured.getTime()) ? "Unavailable" : captured.toISOString();
}
