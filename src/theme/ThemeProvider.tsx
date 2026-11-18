import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import {
  createPalette,
  mobileThemes,
  type MobileThemeId,
  type MobileThemePreset,
  type Palette,
  type ResolvedMode,
  type ThemeMode,
} from "./palette";

export type {
  MobileThemeId,
  MobileThemePreset,
  Palette,
  ResolvedMode,
  ThemeMode,
};

const THEME_MODE_KEY = "@personai/theme/mode/v1";
const THEME_PRESET_KEY = "@personai/theme/preset/v1";
const LEGACY_THEME_MODE_KEY = "@tron/theme/mode/v1";
// Node-synced skins are gone. Clean up both historical skin keys so a stale
// value can never be interpreted as a mobile theme id.
const LEGACY_THEME_SKIN_KEY = "@tron/theme/skin/v1";
const OLD_THEME_SKIN_KEY = "@personai/theme/skin/v1";

interface ThemeContextValue {
  ready: boolean;
  /** User preference: light, dark or follow the OS. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Mode actually applied after resolving `system`. */
  resolvedMode: ResolvedMode;
  palette: Palette;
  /** Built-in mobile themes; independent from any node. */
  themes: readonly MobileThemePreset[];
  themeId: MobileThemeId;
  activeTheme: MobileThemePreset;
  setThemeId: (themeId: MobileThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// First install follows the device appearance; an explicit choice made in the
// settings screen is persisted and wins afterwards.
const DEFAULT_MODE: ThemeMode = "system";
const DEFAULT_THEME_ID: MobileThemeId = "default";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function isThemeId(value: unknown): value is MobileThemeId {
  return mobileThemes.some((theme) => theme.id === value);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();

  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [themeId, setThemeIdState] = useState<MobileThemeId>(DEFAULT_THEME_ID);

  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [storedMode, storedPreset, legacySkin, oldSkin] =
          await Promise.all([
            AsyncStorage.getItem(THEME_MODE_KEY),
            AsyncStorage.getItem(THEME_PRESET_KEY),
            AsyncStorage.getItem(LEGACY_THEME_SKIN_KEY),
            AsyncStorage.getItem(OLD_THEME_SKIN_KEY),
          ]);
        const legacyMode = storedMode
          ? null
          : await AsyncStorage.getItem(LEGACY_THEME_MODE_KEY);
        if (cancelled) return;
        if (isThemeMode(storedMode)) {
          setModeState(storedMode);
        } else if (isThemeMode(legacyMode)) {
          setModeState(legacyMode);
        }
        if (isThemeId(storedPreset)) {
          setThemeIdState(storedPreset);
        }
        if (legacySkin || oldSkin) {
          // The skin id belonged to the node, not to this device. Drop it.
          await Promise.all([
            AsyncStorage.removeItem(LEGACY_THEME_SKIN_KEY),
            AsyncStorage.removeItem(OLD_THEME_SKIN_KEY),
          ]).catch(() => undefined);
        }
      } catch {
        // Fall back to defaults when storage is unavailable.
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    if (hydratedRef.current) {
      void AsyncStorage.setItem(THEME_MODE_KEY, nextMode).catch(() => undefined);
    }
  }, []);

  const setThemeId = useCallback((nextThemeId: MobileThemeId) => {
    setThemeIdState(nextThemeId);
    if (hydratedRef.current) {
      void AsyncStorage.setItem(THEME_PRESET_KEY, nextThemeId).catch(
        () => undefined,
      );
    }
  }, []);

  const resolvedMode: ResolvedMode =
    mode === "system" ? (systemScheme === "light" ? "light" : "dark") : mode;

  const activeTheme = useMemo<MobileThemePreset>(
    () =>
      mobileThemes.find((theme) => theme.id === themeId) ??
      mobileThemes.find((theme) => theme.id === "default")!,
    [themeId],
  );

  const palette = useMemo(
    () =>
      createPalette(resolvedMode, {
        "--color-primary": activeTheme.accent[resolvedMode],
        "--color-on-primary": activeTheme.onAccent[resolvedMode],
      }),
    [activeTheme, resolvedMode],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      ready,
      mode,
      setMode,
      resolvedMode,
      palette,
      themes: mobileThemes,
      themeId,
      activeTheme,
      setThemeId,
    }),
    [
      activeTheme,
      mode,
      palette,
      ready,
      resolvedMode,
      setMode,
      setThemeId,
      themeId,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Creates themed styles and memoizes them per palette. The factory must be a
 * module-level function so the memo key stays stable across renders.
 */
export function useThemedStyles<T extends NamedStyles<T>>(
  factory: (palette: Palette) => T,
): T {
  const { palette } = useTheme();
  return useMemo(() => StyleSheet.create(factory(palette)), [factory, palette]);
}