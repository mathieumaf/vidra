// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_PROFILES, type EncodingProfile } from "../../config/profiles";
import { mount } from "../../test/dom";
import { ProfileBar } from "./ProfileBar";

const personal: EncodingProfile = {
  ...BUILT_IN_PROFILES[0],
  id: "personal-holiday",
  name: "Holiday",
  description: null,
  isBuiltIn: false,
};

function renderBar(overrides: Partial<Parameters<typeof ProfileBar>[0]> = {}) {
  const props: Parameters<typeof ProfileBar>[0] = {
    profiles: [...BUILT_IN_PROFILES, personal],
    selectedProfileId: personal.id,
    isModified: false,
    readyItemCount: 1,
    disabled: false,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onApplyToAll: vi.fn(),
    ...overrides,
  };
  return { props, tree: mount(<ProfileBar {...props} />) };
}

function pressEscape(target: Element | null) {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  });
}

describe("ProfileBar", () => {
  it("returns focus to Rename when Escape closes the editor", () => {
    const { tree } = renderBar();
    const rename = tree.button("Rename");
    tree.click("Rename");

    const input = tree.container.querySelector("input");
    expect(document.activeElement).toBe(input);
    pressEscape(input);

    expect(tree.container.querySelector(".profile-editor")).toBeNull();
    expect(document.activeElement).toBe(rename);
    tree.unmount();
  });

  it("moves focus into the delete confirmation so Escape can close it", () => {
    const { props, tree } = renderBar();
    const remove = tree.button("Delete");
    tree.click("Delete");

    const confirmation = tree.container.querySelector(".profile-delete-confirmation");
    expect(confirmation?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Cancel");
    pressEscape(document.activeElement);

    expect(tree.container.querySelector(".profile-delete-confirmation")).toBeNull();
    expect(document.activeElement).toBe(remove);
    expect(props.onDelete).not.toHaveBeenCalled();
    tree.unmount();
  });

  it("checks an empty name on submit instead of when the field loses focus", () => {
    const { props, tree } = renderBar({ selectedProfileId: BUILT_IN_PROFILES[0].id });
    tree.click("Save a copy");

    const input = tree.container.querySelector<HTMLInputElement>("input");
    act(() => input?.blur());
    expect(tree.container.querySelector("[role=alert]")).toBeNull();

    const submit = tree.button("Save profile");
    expect(submit.disabled).toBe(false);
    act(() => submit.click());
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(tree.container.querySelector("[role=alert]")?.textContent).toBe("Enter a profile name.");
    tree.unmount();
  });
});
