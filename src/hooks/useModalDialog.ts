import { useEffect, useRef } from "react";
import { focusableElements } from "../lib/a11y";

type ModalDialogOptions = {
  /**
   * Closest ancestor, by selector, that bounds the inert background. Use it for a dialog
   * that covers only part of the window, so the uncovered sidebar and window drag regions
   * stay usable. Without it, everything outside the dialog up to the body becomes inert.
   */
  inertWithin?: string;
};

/**
 * Modal dialog behavior: inert background, tab cycle, Escape, and focus restore.
 * Callers unmount the dialog to close it. Without onEscape, Escape does nothing.
 */
export function useModalDialog(onEscape?: () => void, options: ModalDialogOptions = {}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const restoreFocus = useRef<HTMLElement | null>(null);
  const capturedFocus = useRef(false);
  if (!capturedFocus.current) {
    capturedFocus.current = true;
    const active = document.activeElement;
    restoreFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const boundary = options.inertWithin ? dialog.parentElement?.closest<HTMLElement>(options.inertWithin) : null;
    const releaseInert = inertOutside(dialog, boundary ?? document.body);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!onEscapeRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusableElements(dialog);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (!inside || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const active = document.activeElement;
    if (!(active instanceof Node) || !dialog.contains(active)) focusInitial(dialog);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      releaseInert();
      restoreFocus.current?.focus();
    };
  }, []);

  return dialogRef;
}

function focusInitial(dialog: HTMLElement) {
  const preferred = dialog.querySelector<HTMLElement>("[autofocus]");
  if (preferred && !preferred.hasAttribute("disabled") && preferred.getAttribute("aria-disabled") !== "true") {
    preferred.focus();
    return;
  }
  focusableElements(dialog)[0]?.focus();
}

function inertOutside(dialog: HTMLElement, boundary: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  let current: HTMLElement | null = dialog;
  while (current && current !== boundary && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling !== current && sibling instanceof HTMLElement && !sibling.hasAttribute("inert")) {
        sibling.setAttribute("inert", "");
        changed.push(sibling);
      }
    }
    current = parent;
  }
  return () => {
    for (const element of changed) element.removeAttribute("inert");
  };
}
