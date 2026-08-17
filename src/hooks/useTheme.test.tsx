// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "../test/dom";
import { THEME_STORAGE_KEY, type ThemePreference } from "../lib/theme";
import { useTheme } from "./useTheme";

class ThemeMediaQuery {
  readonly media = "(prefers-color-scheme: dark)";
  onchange: ((event: MediaQueryListEvent) => void) | null = null;
  private listeners = new Set<(event: MediaQueryListEvent) => void>();

  constructor(public matches: boolean) {}

  addEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
    this.listeners.delete(listener);
  }

  dispatch(matches: boolean) {
    this.matches = matches;
    const event = { matches, media: this.media } as MediaQueryListEvent;
    this.onchange?.(event);
    for (const listener of this.listeners) listener(event);
  }
}

function ThemeHarness() {
  const theme = useTheme();
  return (
    <div>
      <span>{`${theme.preference}:${theme.resolvedTheme}`}</span>
      {(["auto", "light", "dark"] as ThemePreference[]).map((preference) => (
        <button key={preference} type="button" onClick={() => theme.setPreference(preference)}>
          {preference}
        </button>
      ))}
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("color-scheme");
});

describe("useTheme", () => {
  it("uses the live system theme by default", () => {
    const query = installMatchMedia(true);
    const tree = mount(<ThemeHarness />);

    expect(tree.text()).toContain("auto:dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => query.dispatch(false));
    expect(tree.text()).toContain("auto:light");
    expect(document.documentElement.dataset.theme).toBe("light");
    tree.unmount();
  });

  it("persists an explicit theme and ignores later system changes", () => {
    const query = installMatchMedia(false);
    const tree = mount(<ThemeHarness />);

    tree.click("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => query.dispatch(false));
    expect(tree.text()).toContain("dark:dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    tree.unmount();
  });

  it("restores a stored preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    installMatchMedia(true);

    const tree = mount(<ThemeHarness />);
    expect(tree.text()).toContain("light:light");
    expect(document.documentElement.dataset.theme).toBe("light");
    tree.unmount();
  });
});

function installMatchMedia(matches: boolean): ThemeMediaQuery {
  const query = new ThemeMediaQuery(matches);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => query as unknown as MediaQueryList,
  });
  return query;
}
