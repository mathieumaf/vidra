// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { mount } from "../../test/dom";
import { COPY_START_UNAVAILABLE, END_NOT_AFTER_START } from "../../lib/trim";
import { SegmentOptions } from "./SegmentOptions";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SegmentOptions", () => {
  it("commits a typed segment and can return to the whole video", () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    const tree = mount(
      <SegmentOptions
        durationSeconds={125}
        videoCodec="h264"
        trim={null}
        copyStartSeconds={null}
        copyStartStatus="unknown"
        mediaCount={1}
        disabled={false}
        onChange={onChange}
        onError={onError}
      />,
    );

    const start = tree.container.querySelector<HTMLInputElement>("[aria-label='Segment start time']");
    if (!start) throw new Error("missing start time");
    act(() => setInputValue(start, "0:10"));

    expect(onChange).toHaveBeenCalledWith({ startSeconds: 10, endSeconds: 125 });

    tree.render(
      <SegmentOptions
        durationSeconds={125}
        videoCodec="h264"
        trim={{ startSeconds: 10, endSeconds: 125 }}
        copyStartSeconds={null}
        copyStartStatus="unknown"
        mediaCount={1}
        disabled={false}
        onChange={onChange}
        onError={onError}
      />,
    );
    expect(tree.text()).toContain("Convert a segment");
    tree.click("Use the whole video");
    expect(onChange).toHaveBeenLastCalledWith(null);
    tree.unmount();
  });

  it("explains a start time that is not before the end", () => {
    const tree = mount(
      <SegmentOptions
        durationSeconds={30}
        videoCodec="copy"
        trim={{ startSeconds: 5, endSeconds: 20 }}
        copyStartSeconds={5}
        copyStartStatus="ready"
        mediaCount={2}
        disabled={false}
        onChange={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const end = tree.container.querySelector<HTMLInputElement>("[aria-label='Segment end time']");
    if (!end) throw new Error("missing end time");
    act(() => setInputValue(end, "0:04"));

    expect(tree.text()).toContain(END_NOT_AFTER_START);
    expect(tree.text()).toContain("previous saved picture");
    expect(tree.text()).toContain("applies only to the video shown above");
    tree.unmount();
  });

  it("shows a failed keyframe lookup instead of checking forever", () => {
    const onError = vi.fn();
    const tree = mount(
      <SegmentOptions
        durationSeconds={20}
        videoCodec="copy"
        trim={{ startSeconds: 7.3, endSeconds: 12.8 }}
        copyStartSeconds={null}
        copyStartStatus="failed"
        mediaCount={1}
        disabled={false}
        onChange={vi.fn()}
        onError={onError}
      />,
    );

    expect(tree.text()).toContain("Unavailable");
    expect(tree.text()).not.toContain("Checking");
    expect(tree.text()).toContain(COPY_START_UNAVAILABLE);
    expect(onError).toHaveBeenCalledWith(COPY_START_UNAVAILABLE);
    tree.unmount();
  });

  it("keeps a pending keyframe lookup on Checking", () => {
    const tree = mount(
      <SegmentOptions
        durationSeconds={20}
        videoCodec="copy"
        trim={{ startSeconds: 7.3, endSeconds: 12.8 }}
        copyStartSeconds={null}
        copyStartStatus="checking"
        mediaCount={1}
        disabled={false}
        onChange={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(tree.text()).toContain("Checking…");
    expect(tree.text()).not.toContain("Unavailable");
    tree.unmount();
  });
});
