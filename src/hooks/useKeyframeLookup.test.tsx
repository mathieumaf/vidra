// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { queueItemFixture } from "../test/fixtures";
import { mount } from "../test/dom";
import { useKeyframeLookup } from "./useKeyframeLookup";
import type { CopyStartStatus } from "../types/media";

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
});
