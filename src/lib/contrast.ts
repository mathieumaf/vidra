/** Relative luminance and contrast ratio from WCAG 2.2. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = srgbChannels(color);
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function srgbChannels(color: string): [number, number, number] {
  const hex = color.trim().replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((channel) => channel + channel).join("")
    : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected a hex color, received “${color}”.`);
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
