// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_PROFILES } from "../../config/profiles";
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
    updaterState: { channel: "stable", phase: "up-to-date", update: null, error: null },
    isUpdateBlocked: false,
    profiles: [],
    defaultProfileId: null,
    lastUsedProfileId: "",
    themePreference: "auto",
    onDuplicateProfile: vi.fn(),
    onRenameProfile: vi.fn(),
    onDeleteProfile: vi.fn(),
    onDefaultProfileChange: vi.fn(),
    onThemePreferenceChange: vi.fn(),
    onOpenSource: vi.fn(),
    onOpenRelease: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onUpdateChannelChange: vi.fn(),
    onInstallUpdate: vi.fn(),
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

  it("explains an engine that is not the pinned release version", () => {
    const { tree } = renderSettings({
      isReady: false,
      status: {
        ready: false,
        ffmpegVersion: "ffmpeg version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
        ffprobeVersion: "ffprobe version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
        error: "FFmpeg 7.1.5 does not match Vidra's required 8.1.3 engine. The development override is in use, so this is not the pinned release build.",
      },
    });

    expect(tree.text()).toContain("Unavailable");
    expect(tree.text()).toContain("FFmpeg 7.1.5 does not match Vidra's required 8.1.3 engine.");
    expect(tree.text()).toContain("ffmpeg version 7.1.5");
    tree.unmount();
  });

  it("offers an available update only when conversions are idle", () => {
    const update = {
      currentVersion: "1.2.3",
      version: "1.2.4",
      date: null,
      notes: "Improves update safety.",
    };
    const available = renderSettings({
      updaterState: { channel: "stable", phase: "available", update, error: null },
    });

    available.tree.click("Install and restart");
    expect(available.props.onInstallUpdate).toHaveBeenCalledOnce();
    expect(available.tree.text()).toContain("Improves update safety.");
    available.tree.unmount();

    const blocked = renderSettings({
      updaterState: { channel: "stable", phase: "available", update, error: null },
      isUpdateBlocked: true,
    });
    expect(blocked.tree.button("Install and restart").disabled).toBe(true);
    expect(blocked.tree.text()).toContain("Finish or cancel every queued conversion");
    blocked.tree.unmount();
  });

  it("opens the source and matching release actions", () => {
    const { props, tree } = renderSettings();

    tree.click("Source code");
    tree.click("Release v1.2.3-beta.1");

    expect(props.onOpenSource).toHaveBeenCalledOnce();
    expect(props.onOpenRelease).toHaveBeenCalledOnce();
    tree.unmount();
  });

  it("changes the application appearance from its automatic default", () => {
    const { props, tree } = renderSettings();

    const auto = tree.button("Auto");
    expect(auto.getAttribute("aria-checked")).toBe("true");
    expect(auto.tabIndex).toBe(0);
    expect(tree.button("Dark").tabIndex).toBe(-1);
    act(() => {
      auto.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect(props.onThemePreferenceChange).toHaveBeenCalledWith("light");
    expect(document.activeElement).toBe(tree.button("Light"));
    tree.click("Dark");

    expect(props.onThemePreferenceChange).toHaveBeenCalledWith("dark");
    tree.unmount();
  });

  it("offers two channels, explains beta opt-in, and locks the choice during installation", () => {
    const stable = renderSettings();
    const select = stable.tree.container.querySelector<HTMLSelectElement>('select[aria-label="Update channel"]')!;
    expect(select.value).toBe("stable");
    expect([...select.options].map((option) => option.text)).toEqual(["Stable", "Beta"]);
    expect(stable.tree.text()).toContain("Official releases only");
    expect(stable.tree.text()).toContain("until a newer stable release is available");
    act(() => {
      select.value = "beta";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(stable.props.onUpdateChannelChange).toHaveBeenCalledWith("beta");
    stable.tree.unmount();

    const beta = renderSettings({ updaterState: { channel: "beta", phase: "installing", update: null, error: null } });
    expect(beta.tree.text()).toContain("Test builds may have issues");
    expect(beta.tree.container.querySelector<HTMLSelectElement>('select[aria-label="Update channel"]')!.disabled).toBe(true);
    beta.tree.unmount();
  });

  it("keeps all principal third-party notices inside the application", () => {
    const outside = document.createElement("button");
    outside.textContent = "Outside the dialog";
    document.body.append(outside);
    const { tree } = renderSettings();

    const open = tree.button("View notices");
    act(() => open.focus());
    tree.click("View notices");

    const dialog = tree.container.querySelector("[role=dialog]");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(tree.button("Close third-party notices"));
    expect(outside.hasAttribute("inert")).toBe(true);
    expect(tree.container.querySelector(".notices-content")?.getAttribute("tabindex")).toBe("0");
    for (const component of ["FFmpeg and FFprobe", "x264", "x265", "SVT-AV1", "dav1d", "Opus", "zimg"]) {
      expect(tree.text()).toContain(component);
    }
    expect(tree.text()).toContain("GPL-2.0-or-later");
    expect(tree.text()).toContain("BSD-3-Clause");

    act(() => {
      tree.button("Close third-party notices").dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
      }));
    });
    expect(tree.container.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(open);
    expect(outside.hasAttribute("inert")).toBe(false);
    outside.remove();
    tree.unmount();
  });

  it("associates an empty profile name with an error", () => {
    const profile = {
      ...BUILT_IN_PROFILES[0],
      id: "personal-holiday",
      name: "Holiday",
      description: null,
      isBuiltIn: false,
    };
    const { tree } = renderSettings({ profiles: [profile] });

    tree.click("Rename");
    const input = tree.container.querySelector<HTMLInputElement>('input[aria-label="Profile name"]');
    if (!input) throw new Error("Missing profile name field");
    setNativeValue(input, "");
    const form = input.closest("form");
    act(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(input.getAttribute("aria-invalid")).toBe("true");
    const errorId = input.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(tree.container.querySelector(`#${CSS.escape(errorId ?? "")}`)?.textContent).toBe("Enter a profile name.");
    tree.unmount();
  });
});

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
}
