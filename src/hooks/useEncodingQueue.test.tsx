// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncodingQueue } from "./useEncodingQueue";
import { DEFAULT_ADVANCED_SETTINGS } from "../config/advanced";
import { QUALITY_LEVELS } from "../config/quality";
import {
  clearQueueSession,
  rememberedQueueItems,
  rememberQueueItems,
} from "../lib/queueSession";
import { encodingItemFixture, queueItemFixture } from "../test/fixtures";
import { mount } from "../test/dom";

const dialogMocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  open: vi.fn(async () => null),
  save: vi.fn(async () => null as string | null),
}));
const encodingMocks = vi.hoisted(() => ({
  cancelEncode: vi.fn(async () => {}),
  enqueueEncodes: vi.fn(async () => [] as {
    jobId: string;
    inputPath: string;
    outputPath: string;
  }[]),
  moveQueuedEncode: vi.fn(async () => {}),
  probeMedia: vi.fn(),
  setEncodePaused: vi.fn(async () => {}),
  startEncodeQueue: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);
vi.mock("../services/encoding", () => encodingMocks);

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
      <p>
        {queue.items.length} in the queue: {queue.items[0]?.media.name ?? "nothing"}
        {" · "}{queue.items[0]?.status ?? "empty"}
      </p>
      <p>{queue.error ?? "No queue error"}</p>
      <button type="button" onClick={() => void queue.startEncoding()}>Start encoding</button>
      <button type="button" onClick={queue.reset}>Clear the queue</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dialogMocks.save.mockResolvedValue("/Users/casey/Movies/output.mp4");
});

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

  it("warns without queuing when destination space is insufficient", async () => {
    rememberQueueItems([queueItemFixture()]);
    encodingMocks.enqueueEncodes.mockRejectedValueOnce({
      code: "insufficient_disk_space",
      message: "This conversion may need about 8 GB, but the destination has about 1 GB available.",
    });
    dialogMocks.confirm.mockResolvedValueOnce(false);
    const tree = mount(<QueueProbe />);

    await act(async () => tree.button("Start encoding").click());

    expect(dialogMocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining("destination has about 1 GB available"),
      expect.objectContaining({
        title: "Not enough destination space",
        okLabel: "Proceed anyway",
      }),
    );
    expect(encodingMocks.enqueueEncodes).toHaveBeenCalledTimes(1);
    expect(encodingMocks.startEncodeQueue).not.toHaveBeenCalled();
    expect(tree.text()).toContain("ready");
    tree.unmount();
  });

  it("retries with an explicit override when the user proceeds anyway", async () => {
    rememberQueueItems([queueItemFixture()]);
    encodingMocks.enqueueEncodes
      .mockRejectedValueOnce({
        code: "insufficient_disk_space",
        message: "This conversion may not fit.",
      })
      .mockResolvedValueOnce([{
        jobId: "job-30",
        inputPath: "/Users/casey/Movies/clip.mov",
        outputPath: "/Users/casey/Movies/output.mp4",
      }]);
    dialogMocks.confirm.mockResolvedValueOnce(true);
    const tree = mount(<QueueProbe />);

    await act(async () => tree.button("Start encoding").click());

    expect(encodingMocks.enqueueEncodes).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ allowInsufficientDiskSpace: false })],
    );
    expect(encodingMocks.enqueueEncodes).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ allowInsufficientDiskSpace: true })],
    );
    expect(encodingMocks.startEncodeQueue).toHaveBeenCalledOnce();
    expect(tree.text()).toContain("queued");
    tree.unmount();
  });
});
