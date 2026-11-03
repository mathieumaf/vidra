// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "../../test/dom";
import { Sidebar } from "./Sidebar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
  }),
}));

describe("Sidebar keyboard and status names", () => {
  it("marks the current view and includes the queue count in the accessible name", () => {
    const tree = mount(
      <Sidebar
        view="queue"
        status={{ ready: true, ffmpegVersion: "ffmpeg version 8.1.3", ffprobeVersion: "ffprobe version 8.1.3", error: null }}
        isReady
        queueCount={2}
        onViewChange={vi.fn()}
        onNewConversion={vi.fn()}
      />,
    );

    const queue = tree.button("Queue");
    expect(queue.getAttribute("aria-current")).toBe("page");
    expect(queue.textContent).toContain("2 videos");
    expect(queue.querySelector(".nav-badge span[aria-hidden='true']")?.textContent).toBe("2");
    expect(tree.button("Convert").getAttribute("aria-current")).toBeNull();
    expect(tree.container.querySelector(".engine-status")?.getAttribute("role")).toBe("status");
    expect(tree.container.querySelector(".engine-status")?.textContent).toContain("FFmpeg ready");
    expect(tree.container.querySelector(".status-dot")?.getAttribute("aria-hidden")).toBe("true");
    tree.unmount();
  });
});
