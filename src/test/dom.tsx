import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export type MountedTree = {
  container: HTMLElement;
  text: () => string;
  render: (node: ReactNode) => void;
  click: (label: string) => void;
  button: (label: string) => HTMLButtonElement;
  unmount: () => void;
};

/**
 * Minimal client rendering helper: error boundaries only run in a real render,
 * so component tests for failure states cannot use static markup.
 */
export function mount(node: ReactNode): MountedTree {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));

  function button(label: string): HTMLButtonElement {
    const buttons = [...container.querySelectorAll("button")];
    const match = buttons.find((candidate) => (
      candidate.textContent?.includes(label) || candidate.getAttribute("aria-label") === label
    ));
    if (!match) {
      const available = buttons.map((candidate) => candidate.textContent?.trim()).join(", ");
      throw new Error(`No button matching “${label}”. Available: ${available || "none"}`);
    }
    return match;
  }

  return {
    container,
    text: () => container.textContent ?? "",
    render: (next: ReactNode) => act(() => root.render(next)),
    button,
    click: (label: string) => {
      const target = button(label);
      act(() => target.click());
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
