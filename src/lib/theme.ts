export const THEME_STORAGE_KEY = "vidra.theme-preference";
export const SYSTEM_DARK_THEME_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function storeThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}

export function systemTheme(): ResolvedTheme {
  return systemThemeQuery()?.matches ? "dark" : "light";
}

export function resolveTheme(
  preference: ThemePreference,
  currentSystemTheme: ResolvedTheme,
): ResolvedTheme {
  return preference === "auto" ? currentSystemTheme : preference;
}

export function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function initializeTheme() {
  applyTheme(resolveTheme(readThemePreference(), systemTheme()));
}

export function systemThemeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(SYSTEM_DARK_THEME_QUERY)
    : null;
}

function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "auto";
}
