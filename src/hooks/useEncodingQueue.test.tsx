// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncodingQueue } from "./useEncodingQueue";
import { DEFAULT_ADVANCED_SETTINGS } from "../config/advanced";
import { QUALITY_LEVELS } from "../config/quality";
import {
  PENDING_QUEUE_STORAGE_KEY,
  parsePendingQueue,
  pendingQueueEntries,
  serializePendingQueue,
} from "../lib/pendingQueue";
import {
  clearQueueSession,
  rememberedQueueItems,
  rememberQueueItems,
} from "../lib/queueSession";
import {
  encodingItemFixture,
  mediaFixture,
  queueItemFixture,
} from "../test/fixtures";
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
      <p>Restore offer: {queue.restoreOffer?.entries.length ?? 0}</p>
      <p>Quality: {queue.items[0]?.settings.quality ?? "none"}</p>
      <p>Status: {queue.items[0]?.status ?? "none"}</p>
      <p>{queue.notice}</p>
      <button type="button" onClick={() => void queue.restorePendingQueue()}>
        Restore saved queue
      </button>
      <button type="button" onClick={queue.discardPendingQueue}>Discard saved queue</button>
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
  localStorage.clear();
  vi.clearAllMocks();
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

  it("offers persisted work on launch and restores it only after confirmation", async () => {
    const saved = queueItemFixture({
      settings: {
        ...queueItemFixture().settings,
        quality: "high-quality",
        videoCodec: "h265",
      },
    });
    localStorage.setItem(
      PENDING_QUEUE_STORAGE_KEY,
      serializePendingQueue(pendingQueueEntries([saved])),
    );
    encodingMocks.probeMedia.mockResolvedValue(saved.media);

    const tree = mount(<QueueProbe />);

    expect(tree.text()).toContain("0 in the queue: nothing");
    expect(tree.text()).toContain("Restore offer: 1");
    expect(encodingMocks.probeMedia).not.toHaveBeenCalled();

    await act(async () => {
      tree.button("Restore saved queue").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(tree.text()).toContain("1 in the queue: clip.mov");
    expect(tree.text()).toContain("Restore offer: 0");
    expect(tree.text()).toContain("Quality: high-quality");
    expect(tree.text()).toContain("Restored 1 video with saved settings");
    tree.unmount();
  });

  it("drops unavailable sources and explains each missing entry", async () => {
    const available = queueItemFixture({ media: mediaFixture("available.mov") });
    const missing = queueItemFixture({ media: mediaFixture("missing.mov") });
    localStorage.setItem(
      PENDING_QUEUE_STORAGE_KEY,
      serializePendingQueue(pendingQueueEntries([available, missing])),
    );
    encodingMocks.probeMedia.mockImplementation(async (path: string) => {
      if (path.endsWith("missing.mov")) throw new Error("Path does not exist");
      return available.media;
    });

    const tree = mount(<QueueProbe />);
    await act(async () => {
      tree.button("Restore saved queue").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(tree.text()).toContain("1 in the queue: available.mov");
    expect(tree.text()).toContain("Could not restore “missing.mov”");
    expect(tree.text()).toContain(missing.media.path);
    expect(tree.text()).toContain("source file could not be read from the saved location");
    expect(parsePendingQueue(localStorage.getItem(PENDING_QUEUE_STORAGE_KEY))?.entries)
      .toHaveLength(1);
    tree.unmount();
  });

  it("discards saved work without adding it to the live queue", () => {
    const saved = queueItemFixture();
    localStorage.setItem(
      PENDING_QUEUE_STORAGE_KEY,
      serializePendingQueue(pendingQueueEntries([saved])),
    );
    const tree = mount(<QueueProbe />);

    tree.click("Discard saved queue");

    expect(tree.text()).toContain("0 in the queue: nothing");
    expect(tree.text()).toContain("Restore offer: 0");
    expect(localStorage.getItem(PENDING_QUEUE_STORAGE_KEY)).toBeNull();
    tree.unmount();
  });

  it("removes a job from persistence before starting its process", async () => {
    const ready = queueItemFixture();
    rememberQueueItems([ready]);
    dialogMocks.save.mockResolvedValue("/Users/casey/Movies/encoded.mp4");
    encodingMocks.enqueueEncodes.mockResolvedValue([{
      jobId: "job-1",
      inputPath: ready.media.path,
      outputPath: "/Users/casey/Movies/encoded.mp4",
    }]);
    encodingMocks.startEncodeQueue.mockImplementation(async () => {
      expect(localStorage.getItem(PENDING_QUEUE_STORAGE_KEY)).toBeNull();
    });
    const tree = mount(<QueueProbe />);

    expect(parsePendingQueue(localStorage.getItem(PENDING_QUEUE_STORAGE_KEY))?.entries)
      .toHaveLength(1);
    await act(async () => {
      tree.button("Start encoding").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(encodingMocks.startEncodeQueue).toHaveBeenCalledOnce();
    expect(tree.text()).toContain("Status: encoding");
    expect(localStorage.getItem(PENDING_QUEUE_STORAGE_KEY)).toBeNull();
    tree.unmount();
  });
});
