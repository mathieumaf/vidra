// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_PROFILES } from "../../config/profiles";
import { mount } from "../../test/dom";
import { PendingQueueRestoreOffer } from "./PendingQueueRestoreOffer";

const snapshot = {
  version: 1 as const,
  entries: [
    {
      sourcePath: "/Movies/holiday.mov",
      sourceName: "holiday.mov",
      settings: BUILT_IN_PROFILES[0].settings,
      trackSelection: { audioStreamIndexes: [1], subtitleStreamIndexes: [] },
    },
    {
      sourcePath: "/Movies/interview.mkv",
      sourceName: "interview.mkv",
      settings: BUILT_IN_PROFILES[1].settings,
      trackSelection: { audioStreamIndexes: [], subtitleStreamIndexes: [2] },
    },
  ],
};

describe("PendingQueueRestoreOffer", () => {
  it("offers the saved queue without starting it", () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    const tree = mount(
      <PendingQueueRestoreOffer
        snapshot={snapshot}
        canRestore
        isRestoring={false}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    );

    expect(tree.container.querySelector("[role=dialog]")).not.toBeNull();
    expect(tree.text()).toContain("holiday.mov");
    expect(tree.text()).toContain("interview.mkv");
    expect(tree.text()).toContain("Encoding will not start automatically");
    expect(document.activeElement).toBe(tree.button("Restore queue"));

    act(() => {
      tree.button("Restore queue").dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Tab",
      }));
    });
    expect(document.activeElement).toBe(tree.button("Start fresh"));

    tree.click("Restore queue");
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onDiscard).not.toHaveBeenCalled();
    tree.unmount();
  });

  it("lets the user discard the offer and waits until local tools are ready", () => {
    const onDiscard = vi.fn();
    const tree = mount(
      <PendingQueueRestoreOffer
        snapshot={snapshot}
        canRestore={false}
        isRestoring={false}
        onRestore={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    expect(tree.button("Restore queue").disabled).toBe(true);
    expect(document.activeElement).toBe(tree.button("Start fresh"));
    expect(tree.text()).toContain("Waiting for the local encoding tools");
    tree.click("Start fresh");
    expect(onDiscard).toHaveBeenCalledOnce();
    tree.unmount();
  });
});
