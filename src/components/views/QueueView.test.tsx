import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { encodingItemFixture } from "../../test/fixtures";
import { QueueView } from "./QueueView";

const noop = vi.fn();

describe("QueueView", () => {
  it("shows activity details without an ETA when progress is indeterminate", () => {
    const item = encodingItemFixture("live-stream.ts");
    item.progress = {
      ...item.progress,
      percent: 0,
      indeterminate: true,
      elapsedSeconds: 12,
      outTimeSeconds: 7,
      speed: "0.8x",
      etaSeconds: null,
      frame: 321,
    };

    const markup = renderToStaticMarkup(
      <QueueView
        items={[item]}
        isReady
        isProbing={false}
        error={null}
        notice={null}
        controlItem={item}
        onAddVideos={noop}
        onStart={noop}
        onRevealOutput={noop}
        onRemoveOrCancel={noop}
        onToggleQueue={noop}
        onMove={noop}
        onEdit={noop}
        onGoToConvert={noop}
      />,
    );

    expect(markup).toContain("Working…");
    expect(markup).toContain("0:12 elapsed");
    expect(markup).toContain("0:07 processed");
    expect(markup).toContain("321 frames");
    expect(markup).toContain('class="progress-value indeterminate"');
    expect(markup).not.toContain("Estimating…");
    expect(markup).not.toContain("left");
    expect(markup).not.toContain("0%");
  });
});
