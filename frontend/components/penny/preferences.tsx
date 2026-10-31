"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type ThemeSetting = "light" | "dark" | "system";

const THEME_KEY = "penny-theme";
const PALETTE_KEY = "penny-palette";

export type PaletteSetting = "original" | "noir" | "emerald" | "sapphire" | "bordeaux" | "pearl";

/** Colour styles. Tokens live in globals.css under [data-palette]; swatches are canvas, primary, accent, gold. */
export const PALETTE_OPTIONS: { value: PaletteSetting; label: string; description: string; font: string; swatches: { light: string[]; dark: string[] } }[] = [
  { value: "original", label: "Penny", description: "Calm teal and navy. The original look.", font: "Inter", swatches: { light: ["#f6f8fb", "#173f5f", "#15977f", "#efad3d"], dark: ["#0d1720", "#81b9e6", "#4bc2a8", "#e8b95f"] } },
  { value: "noir", label: "Noir & Gold", description: "Black lacquer, ivory, and champagne gold.", font: "Didot", swatches: { light: ["#f7f4ee", "#16130e", "#a8842c", "#c9a24a"], dark: ["#0b0a08", "#d4af5a", "#d4af5a", "#d4af5a"] } },
  { value: "emerald", label: "Emerald Club", description: "Deep emerald with antique brass.", font: "Baskerville", swatches: { light: ["#f5f3ec", "#0f4c3a", "#1f7a5c", "#b8913f"], dark: ["#08140f", "#c9a85a", "#4cb88f", "#c9a85a"] } },
  { value: "sapphire", label: "Midnight Sapphire", description: "Ink navy with sapphire and platinum.", font: "Avenir Next", swatches: { light: ["#f3f5f9", "#14245c", "#2f56c4", "#c7a35a"], dark: ["#070b1a", "#a9bdf2", "#7d9cf0", "#d8bc7c"] } },
  { value: "bordeaux", label: "Bordeaux", description: "Wine red with rose gold.", font: "Palatino", swatches: { light: ["#f8f3f0", "#6d1a2e", "#a85a54", "#c49a5a"], dark: ["#140809", "#e6a7a0", "#e3a197", "#d9b57a"] } },
  { value: "pearl", label: "Pearl & Champagne", description: "Soft pearl, espresso, and champagne.", font: "Optima", swatches: { light: ["#faf8f5", "#3d342c", "#a07d52", "#c5a572"], dark: ["#13110f", "#e3cba4", "#d6b88a", "#d6b88a"] } },
];
const PALETTE_VALUES = PALETTE_OPTIONS.map((option) => option.value);

const SURFACE_KEY = "penny-surface";
export type SurfaceSetting = "classic" | "glass" | "soft" | "clay" | "flat" | "halo";

/** How cards and panels are built. Rules live in globals.css under [data-surface]. */
export const SURFACE_OPTIONS: { value: SurfaceSetting; label: string; description: string }[] = [
  { value: "classic", label: "Classic", description: "Clean cards with a soft shadow." },
  { value: "glass", label: "Glass", description: "Frosted, see-through panels over colour." },
  { value: "soft", label: "Soft", description: "Neumorphic: pressed out of the page." },
  { value: "clay", label: "Clay", description: "Puffy, rounded, and playful." },
  { value: "flat", label: "Flat", description: "No shadows, crisp hairlines." },
  { value: "halo", label: "Halo", description: "A fine gilded edge with a soft glow." },
];
const SURFACE_VALUES = SURFACE_OPTIONS.map((option) => option.value);

export const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match device" },
];

/**
 * Runs inline in <head> before React hydrates, so the saved theme applies on
 * the very first paint (no flash). Keep it dependency-free and tolerant of blocked storage.
 */
export const PREFERENCES_BOOT_SCRIPT = `(() => {
  const root = document.documentElement;
  let theme = "system";
  let palette = "original";
  let surface = "classic";
  try {
    theme = localStorage.getItem("${THEME_KEY}") || theme;
    palette = localStorage.getItem("${PALETTE_KEY}") || palette;
    surface = localStorage.getItem("${SURFACE_KEY}") || surface;
  } catch {}
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  if (${JSON.stringify(PALETTE_VALUES)}.includes(palette) && palette !== "original") root.dataset.palette = palette;
  if (${JSON.stringify(SURFACE_VALUES)}.includes(surface) && surface !== "classic") root.dataset.surface = surface;
})();`;

type Preferences = {
  theme: ThemeSetting;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeSetting) => void;
  palette: PaletteSetting;
  setPalette: (palette: PaletteSetting) => void;
  surface: SurfaceSetting;
  setSurface: (surface: SurfaceSetting) => void;
};

const PreferencesContext = createContext<Preferences | null>(null);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked: keep the in-memory choice */ }
}

/** Briefly enables colour transitions so a manual theme switch cross-fades instead of snapping. */
function withThemeTransition(apply: () => void) {
  const root = document.documentElement;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { apply(); return; }
  root.classList.add("theme-transition");
  apply();
  window.setTimeout(() => root.classList.remove("theme-transition"), 250);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
const subscribeToSystemTheme = (onChange: () => void) => {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  // The boot script has already applied these; reading them lazily keeps React in agreement.
  const [theme, setThemeState] = useState<ThemeSetting>(() => (typeof window === "undefined" ? "system" : read(THEME_KEY, ["light", "dark", "system"] as const, "system")));
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, () => window.matchMedia(DARK_QUERY).matches, () => false);

  const [palette, setPaletteState] = useState<PaletteSetting>(() => (typeof window === "undefined" ? "original" : read(PALETTE_KEY, PALETTE_VALUES, "original")));
  const [surface, setSurfaceState] = useState<SurfaceSetting>(() => (typeof window === "undefined" ? "classic" : read(SURFACE_KEY, SURFACE_VALUES, "classic")));
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme !== resolvedTheme) withThemeTransition(() => { root.dataset.theme = resolvedTheme; });
  }, [resolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    const next = palette === "original" ? undefined : palette;
    if (root.dataset.palette !== next) withThemeTransition(() => { if (next) root.dataset.palette = next; else delete root.dataset.palette; });
  }, [palette]);

  useEffect(() => {
    const root = document.documentElement;
    const next = surface === "classic" ? undefined : surface;
    if (root.dataset.surface !== next) withThemeTransition(() => { if (next) root.dataset.surface = next; else delete root.dataset.surface; });
  }, [surface]);

  const setTheme = useCallback((value: ThemeSetting) => { write(THEME_KEY, value); setThemeState(value); }, []);
  const setPalette = useCallback((value: PaletteSetting) => { write(PALETTE_KEY, value); setPaletteState(value); }, []);
  const setSurface = useCallback((value: SurfaceSetting) => { write(SURFACE_KEY, value); setSurfaceState(value); }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme, palette, setPalette, surface, setSurface }), [theme, resolvedTheme, setTheme, palette, setPalette, surface, setSurface]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
