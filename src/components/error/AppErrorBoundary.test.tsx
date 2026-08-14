// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { FailureState } from "./FailureState";
import { conversionActivity } from "../../lib/conversionActivity";
import { clearQueueSession, rememberQueueItems } from "../../lib/queueSession";
import { copyDiagnosticReport } from "../../services/diagnostics";
import { encodingItemFixture, mediaFixture, queueItemFixture } from "../../test/fixtures";
import { mount } from "../../test/dom";
import type { EncodeQueueItem } from "../../types/media";

vi.mock("../../services/diagnostics", () => ({
  copyDiagnosticReport: vi.fn(async () => {}),
  saveDiagnosticReport: vi.fn(async () => true),
}));

let failing = true;

function BrokenView() {
  if (failing) throw new TypeError("Cannot read properties of undefined (reading 'media')");
  return <p>Queue view content</p>;
}

/** Stands in for App: the queue lives outside the boundary, the view inside it. */
function Shell({ items, view = "queue" }: { items: EncodeQueueItem[]; view?: string }) {
  const [queue, setQueue] = useState(items);

  return (
    <div>
      <p>Queue holds {queue.length} conversions</p>
      <button type="button" onClick={() => setQueue((current) => [...current, queueItemFixture({
        media: mediaFixture(`added-${current.length}.mov`),
      })])}>
        Add to queue
      </button>
      <AppErrorBoundary
        resetKey={view}
        renderFallback={(failure) => (
          <FailureState
            title="Queue could not be displayed"
            description="The rest of Vidra keeps working."
            message={failure.message}
            activity={conversionActivity(queue)}
            diagnostic={failure.diagnostic}
            onRetry={failure.retry}
          />
        )}
      >
        <BrokenView />
      </AppErrorBoundary>
    </div>
  );
}

beforeEach(() => {
  failing = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  clearQueueSession();
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("renders children while nothing fails", () => {
    failing = false;
    const tree = mount(<Shell items={[]} />);

    expect(tree.text()).toContain("Queue view content");
    tree.unmount();
  });

  it("explains a render failure instead of leaving an empty tree", () => {
    const tree = mount(<Shell items={[]} />);

    expect(tree.text()).toContain("Queue could not be displayed");
    expect(tree.text()).toContain("Cannot read properties of undefined");
    expect(tree.text()).toContain("Try again");
    expect(tree.text()).not.toContain("Queue view content");
    expect(tree.container.querySelector("[role=alert]")).not.toBeNull();
    tree.unmount();
  });

  it("says whether a conversion is still running", () => {
    const running = mount(<Shell items={[encodingItemFixture("holiday.mov", 42)]} />);
    expect(running.text()).toContain("A conversion is still running");
    expect(running.text()).toContain("holiday.mov");
    expect(running.text()).toContain("42%");
    running.unmount();

    const idle = mount(<Shell items={[]} />);
    expect(idle.text()).toContain("No conversion is running");
    idle.unmount();
  });

  it("recovers on demand without losing the queue", () => {
    const tree = mount(<Shell items={[encodingItemFixture("holiday.mov")]} />);

    tree.click("Add to queue");
    expect(tree.text()).toContain("Queue holds 2 conversions");

    failing = false;
    tree.click("Try again");

    expect(tree.text()).toContain("Queue view content");
    expect(tree.text()).toContain("Queue holds 2 conversions");
    tree.unmount();
  });

  it("clears the failure when the user switches view", () => {
    const tree = mount(<Shell items={[]} view="queue" />);
    expect(tree.text()).toContain("Queue could not be displayed");

    failing = false;
    tree.render(<Shell items={[]} view="history" />);

    expect(tree.text()).toContain("Queue view content");
    tree.unmount();
  });

  it("keeps showing the failure state when recovery fails again", () => {
    const tree = mount(<Shell items={[]} />);

    tree.click("Try again");

    expect(tree.text()).toContain("Queue could not be displayed");
    expect(tree.text()).not.toContain("Queue view content");
    tree.unmount();
  });

  it("lets the user copy a diagnostic report for the failure", () => {
    // The queue hook publishes the queue so a report describes the running work.
    rememberQueueItems([encodingItemFixture()]);
    const tree = mount(<Shell items={[encodingItemFixture()]} />);

    tree.click("Copy");

    expect(copyDiagnosticReport).toHaveBeenCalledTimes(1);
    const report = vi.mocked(copyDiagnosticReport).mock.calls[0][0];
    expect(report).toContain("Code: interface_render_error");
    expect(report).toContain("Message: Cannot read properties of undefined (reading 'media')");
    expect(report).toContain("Component stack");
    expect(report).toContain("BrokenView");
    expect(report).toContain("Encoding: 1");
    tree.unmount();
  });
});
