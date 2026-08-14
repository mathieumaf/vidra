// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AppFailureWindow } from "./AppFailureWindow";
import type { BoundaryFailure } from "./AppErrorBoundary";
import { conversionActivity } from "../../lib/conversionActivity";
import { failureDiagnostic } from "../../lib/failure";
import { encodingItemFixture } from "../../test/fixtures";
import { mount } from "../../test/dom";

const nativeWindow = vi.hoisted(() => ({
  startDragging: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }));

function boundaryFailure(attempts = 1): BoundaryFailure {
  return {
    diagnostic: failureDiagnostic({ source: "render", error: new Error("render failed") }),
    message: "render failed",
    attempts,
    retry: vi.fn(),
  };
}

describe("AppFailureWindow", () => {
  it("replaces the blank window with a recoverable failure state", () => {
    const failure = boundaryFailure();
    const onReload = vi.fn();
    const tree = mount(
      <AppFailureWindow
        failure={failure}
        activity={conversionActivity([encodingItemFixture("holiday.mov", 42)])}
        onReload={onReload}
      />,
    );

    expect(tree.text()).toContain("Vidra could not display this window");
    expect(tree.text()).toContain("render failed");
    expect(tree.text()).toContain("A conversion is still running");

    tree.click("Rebuild the interface");
    tree.click("Reload the window");

    expect(failure.retry).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it("keeps the native drag region working", () => {
    const tree = mount(
      <AppFailureWindow
        failure={boundaryFailure()}
        activity={conversionActivity([])}
        onReload={vi.fn()}
      />,
    );

    const dragRegion = tree.container.querySelector(".native-titlebar");
    expect(dragRegion).not.toBeNull();
    dragRegion?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1, detail: 1 }));

    expect(nativeWindow.startDragging).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it("points the user to a reload once rebuilding failed again", () => {
    const tree = mount(
      <AppFailureWindow
        failure={boundaryFailure(3)}
        activity={conversionActivity([])}
        onReload={vi.fn()}
      />,
    );

    expect(tree.text()).toContain("failed again after 3 attempts");
    expect(tree.text()).toContain("Reload the window");
    tree.unmount();
  });
});
