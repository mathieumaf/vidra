import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  storeThemePreference,
  systemTheme,
  systemThemeQuery,
  type ResolvedTheme,
  type ThemePreference,
} from "../lib/theme";

export type ThemeState = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

export function useTheme(): ThemeState {
  const [preference, setPreferenceState] = useState(readThemePreference);
  const [currentSystemTheme, setCurrentSystemTheme] = useState(systemTheme);
  const resolvedTheme = resolveTheme(preference, currentSystemTheme);

  useLayoutEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const query = systemThemeQuery();
    if (!query) return;

    const handleChange = (event: MediaQueryListEvent) => {
      setCurrentSystemTheme(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    storeThemePreference(nextPreference);
    setPreferenceState(nextPreference);
  }, []);

  return { preference, resolvedTheme, setPreference };
}
