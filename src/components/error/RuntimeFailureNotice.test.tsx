// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeFailureNotice } from "./RuntimeFailureNotice";
import { useRuntimeFailure } from "../../hooks/useRuntimeFailure";
import {
  installGlobalFailureHandlers,
  resetRuntimeFailures,
} from "../../lib/runtimeFailures";
import { copyDiagnosticReport } from "../../services/diagnostics";
import { mount } from "../../test/dom";

vi.mock("../../services/diagnostics", () => ({
  copyDiagnosticReport: vi.fn(async () => {}),
  saveDiagnosticReport: vi.fn(async () => true),
}));

function Harness() {
  const { failure, dismiss } = useRuntimeFailure();

  return failure
    ? <RuntimeFailureNotice failure={failure} onDismiss={dismiss} />
    : <p>Nothing failed</p>;
}

function raise(error: Error) {
  act(() => {
    window.dispatchEvent(new ErrorEvent("error", { error }));
  });
}

afterEach(() => {
  resetRuntimeFailures();
  vi.clearAllMocks();
});

describe("RuntimeFailureNotice", () => {
  it("surfaces a failure that happened outside the render path", () => {
    installGlobalFailureHandlers();
    const tree = mount(<Harness />);
    expect(tree.text()).toContain("Nothing failed");

    raise(new Error("Unable to reveal the output file."));

    expect(tree.text()).toContain("Something failed in the background");
    expect(tree.text()).toContain("Unable to reveal the output file.");
    expect(tree.text()).toContain("Conversions already running are not affected.");
    tree.unmount();
  });

  it("counts repeats and can be dismissed", () => {
    installGlobalFailureHandlers();
    const tree = mount(<Harness />);

    raise(new Error("Progress parsing failed."));
    raise(new Error("Progress parsing failed."));
    expect(tree.text()).toContain("Reported 2 times.");

    tree.click("Dismiss this failure");

    expect(tree.text()).toContain("Nothing failed");
    tree.unmount();
  });

  it("offers the diagnostic report of the failure", () => {
    installGlobalFailureHandlers();
    const tree = mount(<Harness />);
    raise(new Error("Progress parsing failed."));

    tree.click("Copy");

    const report = vi.mocked(copyDiagnosticReport).mock.calls[0][0];
    expect(report).toContain("Code: interface_uncaught_error");
    expect(report).toContain("Message: Progress parsing failed.");
    tree.unmount();
  });
});
