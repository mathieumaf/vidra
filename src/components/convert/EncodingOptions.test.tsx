// @vitest-environment jsdom
import { useState } from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { mount } from "../../test/dom";
import type { EncodingSpeed, OutputContainer, VideoCodec } from "../../types/media";
import { EncodingOptions } from "./EncodingOptions";

function Harness({ codec = "h264" as VideoCodec }) {
  const [container, setContainer] = useState<OutputContainer>("mp4");
  const [videoCodec, setVideoCodec] = useState(codec);
  const [speed, setSpeed] = useState<EncodingSpeed>("efficient");
  return (
    <EncodingOptions
      container={container}
      videoCodec={videoCodec}
      encodingSpeed={speed}
      disabled={false}
      onContainerChange={setContainer}
      onVideoCodecChange={setVideoCodec}
      onEncodingSpeedChange={setSpeed}
    />
  );
}

function press(target: HTMLElement, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
}

describe("EncodingOptions keyboard access", () => {
  it("moves format with the arrow keys and keeps one tab stop", () => {
    const tree = mount(<Harness />);
    const mp4 = tree.container.querySelector<HTMLButtonElement>("[data-option-id='mp4']");
    const mkv = tree.container.querySelector<HTMLButtonElement>("[data-option-id='mkv']");
    if (!mp4 || !mkv) throw new Error("Missing format options");

    expect(mp4.getAttribute("aria-checked")).toBe("true");
    expect(mp4.tabIndex).toBe(0);
    expect(mkv.tabIndex).toBe(-1);
    expect(tree.container.querySelector("[aria-label='Format']")?.getAttribute("role")).toBe("radiogroup");

    press(mp4, "ArrowRight");
    expect(mkv.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(mkv);
    expect(mp4.tabIndex).toBe(-1);
    expect(mkv.tabIndex).toBe(0);

    press(mkv, "Home");
    expect(mp4.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(mp4);
    tree.unmount();
  });

  it("explains encoding speed when original video cannot be re-encoded", () => {
    const tree = mount(<Harness codec="copy" />);
    const efficient = tree.container.querySelector<HTMLButtonElement>("[data-option-id='efficient']");
    if (!efficient) throw new Error("Missing encoding speed");

    expect(efficient.getAttribute("aria-disabled")).toBe("true");
    expect(efficient.tabIndex).toBe(0);
    expect(efficient.textContent).toContain("Original video is copied without encoding");
    press(efficient, "ArrowRight");
    expect(efficient.getAttribute("aria-checked")).toBe("true");
    tree.unmount();
  });
});
