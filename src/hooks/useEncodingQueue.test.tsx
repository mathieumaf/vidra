// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEncodingQueue } from "./useEncodingQueue";
import { DEFAULT_ADVANCED_SETTINGS } from "../config/advanced";
import { QUALITY_LEVELS } from "../config/quality";
import {
  clearQueueSession,
  rememberedQueueItems,
  rememberQueueItems,
} from "../lib/queueSession";
import { encodingItemFixture } from "../test/fixtures";
import { mount } from "../test/dom";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

function QueueProbe() {
  const queue = useEncodingQueue({
    isReady: true,
    quality: QUALITY_LEVELS[2],
    outputContainer: "mp4",
    videoCodec: "h264",
    encodingSpeed: "efficient",
    audioMode: "auto",
    outputResolution: "source",
    advancedSettings: DEFAULT_ADVANCED_SETTINGS,
  });

  return (
    <div>
      <p>{queue.items.length} in the queue: {queue.items[0]?.media.name ?? "nothing"}</p>
      <button type="button" onClick={queue.reset}>Clear the queue</button>
    </div>
  );
}

afterEach(() => {
  clearQueueSession();
});

describe("useEncodingQueue", () => {
  it("restores the queue when the interface remounts after a failure", () => {
    rememberQueueItems([encodingItemFixture("holiday.mov")]);

    const tree = mount(<QueueProbe />);

    expect(tree.text()).toContain("1 in the queue: holiday.mov");
    tree.unmount();
  });

  it("publishes queue changes so a failure state can describe them", () => {
    rememberQueueItems([encodingItemFixture("holiday.mov")]);
    const tree = mount(<QueueProbe />);

    tree.click("Clear the queue");

    expect(tree.text()).toContain("0 in the queue: nothing");
    expect(rememberedQueueItems()).toEqual([]);
    tree.unmount();
  });
});
