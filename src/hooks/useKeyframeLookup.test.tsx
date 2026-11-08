// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { queueItemFixture } from "../test/fixtures";
import { mount } from "../test/dom";
import { useKeyframeLookup } from "./useKeyframeLookup";
import type { CopyStartStatus, EncodeQueueItem } from "../types/media";

const encodingMocks = vi.hoisted(() => ({
  segmentKeyframe: vi.fn(async () => 5),
}));

vi.mock("../services/encoding", () => encodingMocks);

function LookupProbe() {
  const base = queueItemFixture();
  const [status, setStatus] = useState<CopyStartStatus>("unknown");
  const [seconds, setSeconds] = useState<number | null>(null);
  useKeyframeLookup(
    [{
      ...base,
      settings: { ...base.settings, videoCodec: "copy" },
      trim: { startSeconds: 7.3, endSeconds: 12.8 },
      copyStartStatus: status,
      copyStartSeconds: seconds,
    }],
    () => setStatus("checking"),
    (_target, result) => {
      if (result.status === "ready") {
        setStatus("ready");
        setSeconds(result.seconds);
      } else {
        setStatus("failed");
        setSeconds(null);
      }
    },
  );
  return <p>{status}:{seconds ?? "none"}</p>;
}

function BatchLookupProbe() {
  const [items, setItems] = useState<EncodeQueueItem[]>(() => ["a", "b"].map((clientId) => {
    const base = queueItemFixture({ clientId });
    return {
      ...base,
      settings: { ...base.settings, videoCodec: "copy" },
      trim: { startSeconds: 7, endSeconds: 12 },
    };
  }));
  useKeyframeLookup(items,
    (target) => setItems((current) => current.map((item) => item.clientId === target.clientId
      ? { ...item, copyStartStatus: "checking" } : item)),
    (target, result) => setItems((current) => current.map((item) => item.clientId === target.clientId
      ? { ...item, copyStartStatus: result.status, copyStartSeconds: result.status === "ready" ? result.seconds : null }
      : item)),
  );
  return <>
    {items.map((item) => <p key={item.clientId}>{item.clientId}:{item.copyStartStatus}:{item.copyStartSeconds ?? "none"}</p>)}
    <button onClick={() => setItems((current) => current.map((item) => item.clientId === "b"
      ? { ...item, trim: { startSeconds: 9, endSeconds: 12 }, copyStartStatus: "unknown" }
      : item))}>Change B</button>
    <button onClick={() => setItems((current) => current.filter((item) => item.clientId !== "b"))}>Remove B</button>
  </>;
}

describe("useKeyframeLookup", () => {
  afterEach(() => {
    vi.useRealTimers();
    encodingMocks.segmentKeyframe.mockReset();
  });

  it("stores a resolved keyframe separately from a failed lookup", async () => {
    vi.useFakeTimers();
    encodingMocks.segmentKeyframe.mockResolvedValue(5);
    const resolved = mount(<LookupProbe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(resolved.text()).toContain("ready:5");
    resolved.unmount();

    encodingMocks.segmentKeyframe.mockRejectedValue(new Error("ffprobe failed"));
    const failed = mount(<LookupProbe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(failed.text()).toContain("failed:none");
    expect(failed.text()).not.toContain("checking");
    failed.unmount();
  });

  it.each(["Change B", "Remove B"])("finishes outstanding lookups after %s cancels the batch", async (action) => {
    vi.useFakeTimers();
    let finishOldRequest!: (seconds: number) => void;
    encodingMocks.segmentKeyframe
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve; }))
      .mockResolvedValue(5);
    const tree = mount(<BatchLookupProbe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(tree.text()).toContain("a:checking:none");
    expect(tree.text()).toContain("b:checking:none");

    tree.click(action);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(tree.text()).toContain("a:ready:5");
    if (action === "Change B") expect(tree.text()).toContain("b:ready:5");
    await act(async () => { finishOldRequest(1); });
    expect(tree.text()).toContain("a:ready:5");
    expect(tree.text()).not.toContain("checking");
    tree.unmount();
  });
});
