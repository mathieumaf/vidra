import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast.ts";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const base = readFileSync("src/styles/base.css", "utf8");
const conversion = readFileSync("src/styles/conversion.css", "utf8");
const [light, dark] = tokens.split(':root[data-theme="dark"]');

function token(block, name) {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
}

describe("appearance contrast", () => {
  const muted = token(light, "--muted");
  const focus = token(light, "--focus-ring");
  const onAccent = token(light, "--on-accent");
  const green = token(light, "--green");
  const greenDark = token(light, "--green-dark");
  const darkMuted = token(dark, "--muted");
  const darkFocus = token(dark, "--focus-ring");
  const darkOnAccent = token(dark, "--on-accent");
  const darkGreen = token(dark, "--green");
  const darkGreenDark = token(dark, "--green-dark");

  it("keeps secondary text at 4.5:1 on light and dark surfaces", () => {
    for (const background of ["#ffffff", "#fafbf9", "#f1f3f0", "#f0f3f0", "#e9eeea"]) {
      expect(contrastRatio(muted, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ["#121714", "#181e1a", "#222824", "#272e29", "#303a34"]) {
      expect(contrastRatio(darkMuted, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps accent labels readable in both appearances", () => {
    expect(contrastRatio(onAccent, green)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onAccent, greenDark)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkOnAccent, darkGreen)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkOnAccent, darkGreenDark)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring at 3:1 against the surfaces around controls", () => {
    for (const background of ["#ffffff", "#fafbf9", "#f1f3f0", "#eef1ed", "#e9eeea"]) {
      expect(contrastRatio(focus, background)).toBeGreaterThanOrEqual(3);
    }
    for (const background of ["#0d110f", "#121714", "#181e1a", "#222824", "#303a34"]) {
      expect(contrastRatio(darkFocus, background)).toBeGreaterThanOrEqual(3);
    }
  });

  it("styles keyboard focus and reduced motion in the base stylesheet", () => {
    expect(base).toContain("outline: 2px solid var(--focus-ring)");
    expect(base).toContain("prefers-reduced-motion: reduce");
    expect(base).toContain("animation: none !important");
    expect(base).toContain("forced-colors: active");
  });

  it("keeps the success detail readable on its pale green background", () => {
    const match = conversion.match(/\.success-message p \{[^}]*color:\s*(#[0-9a-fA-F]{6})/);
    expect(match).not.toBeNull();
    expect(contrastRatio(match?.[1] ?? "#000000", "#edf8f1")).toBeGreaterThanOrEqual(4.5);
  });
});
