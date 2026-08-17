// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_PROFILES } from "../../config/profiles";
import { mount } from "../../test/dom";
import type { HistoryEntry } from "../../types/media";
import { HistoryView } from "./HistoryView";

const dialogMocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);

const historyEntry: HistoryEntry = {
  id: "history-1",
  sourcePath: "/Users/casey/Movies/source.mov",
  sourceName: "source.mov",
  outputPath: "/Users/casey/Movies/source.mp4",
  status: "completed",
  startedAtMs: 1_700_000_000_000,
  finishedAtMs: 1_700_000_060_000,
  mediaDurationSeconds: 60,
  sourceSizeBytes: 10_000_000,
  outputSizeBytes: 5_000_000,
  settings: BUILT_IN_PROFILES[0].settings,
  error: null,
  diagnostic: null,
};

function renderHistory(onClear = vi.fn(async () => {})) {
  const tree = mount(
    <HistoryView
      items={[historyEntry]}
      isLoading={false}
      error={null}
      onGoToConvert={vi.fn()}
      onReveal={vi.fn()}
      onDelete={vi.fn()}
      onClear={onClear}
    />,
  );
  return { onClear, tree };
}

beforeEach(() => {
  vi.clearAllMocks();
  dialogMocks.confirm.mockResolvedValue(false);
});

describe("HistoryView", () => {
  it("clears history only after the native confirmation is accepted", async () => {
    const cancelled = renderHistory();

    await act(async () => {
      cancelled.tree.button("Clear history").click();
    });

    expect(dialogMocks.confirm).toHaveBeenCalledWith(
      "Clear conversion history? Your media files will not be deleted.",
      {
        title: "Clear history",
        kind: "warning",
        okLabel: "Clear history",
        cancelLabel: "Cancel",
      },
    );
    expect(cancelled.onClear).not.toHaveBeenCalled();
    cancelled.tree.unmount();

    dialogMocks.confirm.mockResolvedValueOnce(true);
    const confirmed = renderHistory();

    await act(async () => {
      confirmed.tree.button("Clear history").click();
    });

    expect(confirmed.onClear).toHaveBeenCalledOnce();
    confirmed.tree.unmount();
  });
});
