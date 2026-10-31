// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { mount } from "../../test/dom";

const nativeWindow = vi.hoisted(() => ({
  startDragging: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }));

const sidebarProps = {
  view: "convert" as const,
  status: null,
  isReady: false,
  queueCount: 0,
  onViewChange: vi.fn(),
  onNewConversion: vi.fn(),
};

describe("Sidebar header", () => {
  it("places the logo in the same draggable band as the traffic lights", () => {
    const tree = mount(<Sidebar {...sidebarProps} />);
    const header = tree.container.querySelector(".sidebar-header");
    const brand = header?.querySelector(".brand");

    expect(header).not.toBeNull();
    expect(brand?.textContent).toContain("Vidra");
    expect(header?.getAttribute("aria-hidden")).toBeNull();
    expect(header?.compareDocumentPosition(tree.container.querySelector(".new-conversion")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    header?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1, detail: 1 }));
    expect(nativeWindow.startDragging).toHaveBeenCalledTimes(1);

    header?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1, detail: 2 }));
    expect(nativeWindow.toggleMaximize).toHaveBeenCalledTimes(1);
    tree.unmount();
  });
});
