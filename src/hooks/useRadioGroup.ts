import type { KeyboardEvent } from "react";
import { nextRadioValue } from "../lib/a11y";

const RADIO_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

type RadioOption<T extends string> = {
  id: T;
  disabled?: boolean;
};

export type RadioOptionProps = {
  role: "radio";
  "aria-checked": boolean;
  "aria-disabled"?: true;
  "data-option-id": string;
  tabIndex: 0 | -1;
  disabled?: true;
};

/**
 * Roving tabindex and arrow-key selection for a radiogroup.
 * A disabled group keeps the selected option focusable so its explanation
 * can be reached from the keyboard.
 */
export function useRadioGroup<T extends string>(
  options: readonly RadioOption<T>[],
  value: T,
  onChange: (value: T) => void,
  groupDisabled = false,
) {
  const enabledIds = options.filter((option) => !option.disabled && !groupDisabled).map((option) => option.id);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!RADIO_KEYS.has(event.key)) return;
    const next = nextRadioValue(enabledIds, value, event.key);
    event.preventDefault();
    if (next === null || next === value) {
      const current = event.currentTarget.querySelector<HTMLElement>(`[data-option-id="${value}"]`);
      current?.focus();
      return;
    }
    onChange(next);
    const target = event.currentTarget.querySelector<HTMLElement>(`[data-option-id="${next}"]`);
    target?.focus();
  }

  function optionProps(id: T, optionDisabled = false): RadioOptionProps {
    const selected = id === value;
    const groupBlocked = groupDisabled && !optionDisabled;
    const tabStop = groupBlocked
      ? selected
      : !optionDisabled && !groupDisabled && (selected || (!enabledIds.includes(value) && id === enabledIds[0]));
    return {
      role: "radio",
      "aria-checked": selected,
      "data-option-id": id,
      tabIndex: tabStop ? 0 : -1,
      ...(optionDisabled ? { disabled: true as const } : {}),
      ...(groupBlocked || optionDisabled ? { "aria-disabled": true as const } : {}),
    };
  }

  return { onKeyDown, optionProps };
}
