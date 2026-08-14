// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "../../test/dom";
import { SettingsView } from "./SettingsView";

function renderSettings(overrides: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  const props: Parameters<typeof SettingsView>[0] = {
    status: {
      ready: true,
      ffmpegVersion: "ffmpeg version 8.0.1",
      ffprobeVersion: "ffprobe version 8.0.1",
      error: null,
    },
    isReady: true,
    appVersion: "1.2.3",
    releaseTag: "v1.2.3-beta.1",
    applicationError: null,
    profiles: [],
    defaultProfileId: null,
    lastUsedProfileId: "",
    onDuplicateProfile: vi.fn(),
    onRenameProfile: vi.fn(),
    onDeleteProfile: vi.fn(),
    onDefaultProfileChange: vi.fn(),
    onOpenSource: vi.fn(),
    onOpenRelease: vi.fn(),
    ...overrides,
  };
  return { props, tree: mount(<SettingsView {...props} />) };
}

describe("SettingsView application information", () => {
  it("shows the built Vidra version next to the bundled FFmpeg version", () => {
    const { tree } = renderSettings();

    expect(tree.text()).toContain("VidraApplication version1.2.3");
    expect(tree.text()).toContain("FFmpegBundled encoding engineffmpeg version 8.0.1");
    expect(tree.text()).toContain("GPL-3.0-or-later");
    tree.unmount();
  });

  it("opens the source and matching release actions", () => {
    const { props, tree } = renderSettings();

    tree.click("Source code");
    tree.click("Release v1.2.3-beta.1");

    expect(props.onOpenSource).toHaveBeenCalledOnce();
    expect(props.onOpenRelease).toHaveBeenCalledOnce();
    tree.unmount();
  });

  it("keeps all principal third-party notices inside the application", () => {
    const { tree } = renderSettings();

    tree.click("View notices");

    expect(tree.container.querySelector("[role=dialog]")).not.toBeNull();
    for (const component of ["FFmpeg and FFprobe", "x264", "x265", "SVT-AV1", "Opus", "zimg"]) {
      expect(tree.text()).toContain(component);
    }
    expect(tree.text()).toContain("GPL-2.0-or-later");
    expect(tree.text()).toContain("BSD-3-Clause");

    tree.click("Close third-party notices");
    expect(tree.container.querySelector("[role=dialog]")).toBeNull();
    tree.unmount();
  });
});
