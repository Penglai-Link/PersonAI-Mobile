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

import { isUnauthorizedError } from "../api/client";
import { getActiveSkin, listSkins, type Skin } from "../api/tron";
import { useNodeSession } from "../store/nodeSession";
import { describeError } from "../utils/format";
import {
  createPalette,
  fallbackPalettes,
  skinColors,
  type Palette,
  type ResolvedMode,
  type ThemeMode,
} from "./palette";

export type { Palette, ResolvedMode, Skin, ThemeMode };

const THEME_MODE_KEY = "@personai/theme/mode/v1";
const THEME_SKIN_KEY = "@personai/theme/skin/v1";
const LEGACY_THEME_MODE_KEY = "@tron/theme/mode/v1";
const LEGACY_THEME_SKIN_KEY = "@tron/theme/skin/v1";

interface ThemeContextValue {
  ready: boolean;
  /** User preference: light, dark or follow the OS. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Mode actually applied after resolving `system`. */
  resolvedMode: ResolvedMode;
  palette: Palette;
  /** Skins reported by the currently selected node (empty when offline). */
  skins: Skin[];
  skinId: string | null;
  /** Skin applied for rendering; null means the built-in palette. */
  activeSkin: Skin | null;
  setSkinId: (skinId: string | null) => void;
  refreshSkins: () => Promise<void>;
  loadingSkins: boolean;
  skinsError: string | null;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Preserve the original dark look for first-run users; "system" is available
// from the appearance screen.
const DEFAULT_MODE: ThemeMode = "dark";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function isSkinArray(value: unknown): value is Skin[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Skin).id === "string" &&
        typeof (item as Skin).name === "string",
    )
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const {
    status: sessionStatus,
    nodeKey,
    request: sessionRequest,
  } = useNodeSession();

  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [preferredSkinId, setPreferredSkinIdState] = useState<string | null>(null);
  const [skins, setSkins] = useState<Skin[]>([]);
  const [serverActiveSkin, setServerActiveSkin] = useState<Skin | null>(null);
  const [loadingSkins, setLoadingSkins] = useState(false);
  const [skinsError, setSkinsError] = useState<string | null>(null);

  const modeRef = useRef<ThemeMode>(DEFAULT_MODE);
  const skinRef = useRef<string | null>(null);
  const nodeKeyRef = useRef<string | null>(null);
  const statusRef = useRef(sessionStatus);
  const requestRef = useRef(sessionRequest);
  const hydratedRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    skinRef.current = preferredSkinId;
  }, [preferredSkinId]);

  useEffect(() => {
    nodeKeyRef.current = nodeKey;
  }, [nodeKey]);

  useEffect(() => {
    statusRef.current = sessionStatus;
  }, [sessionStatus]);

  useEffect(() => {
    requestRef.current = sessionRequest;
  }, [sessionRequest]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let [storedMode, storedSkin] = await Promise.all([
          AsyncStorage.getItem(THEME_MODE_KEY),
          AsyncStorage.getItem(THEME_SKIN_KEY),
        ]);
        if (!storedMode) {
          storedMode = await AsyncStorage.getItem(LEGACY_THEME_MODE_KEY);
        }
        if (!storedSkin) {
          storedSkin = await AsyncStorage.getItem(LEGACY_THEME_SKIN_KEY);
        }
        if (cancelled) return;
        if (isThemeMode(storedMode)) {
          modeRef.current = storedMode;
          setModeState(storedMode);
        }
        if (storedSkin && storedSkin.trim()) {
          skinRef.current = storedSkin.trim();
          setPreferredSkinIdState(storedSkin.trim());
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
    modeRef.current = nextMode;
    setModeState(nextMode);
    if (hydratedRef.current) {
      void AsyncStorage.setItem(THEME_MODE_KEY, nextMode).catch(() => undefined);
    }
  }, []);

  const setSkinId = useCallback((nextSkinId: string | null) => {
    skinRef.current = nextSkinId;
    setPreferredSkinIdState(nextSkinId);
    if (hydratedRef.current) {
      void (nextSkinId
        ? AsyncStorage.setItem(THEME_SKIN_KEY, nextSkinId)
        : AsyncStorage.removeItem(THEME_SKIN_KEY)
      ).catch(() => undefined);
    }
  }, []);

  const refreshSkins = useCallback(async () => {
    if (!nodeKeyRef.current || statusRef.current !== "online") {
      return;
    }
    const requestNodeKey = nodeKeyRef.current;
    setLoadingSkins(true);
    setSkinsError(null);
    try {
      const result = await requestRef.current(async ({ baseUrl, token }) => {
        const [list, active] = await Promise.all([
          listSkins({ baseUrl, token, timeoutMs: 12_000 }),
          // A missing/unsupported active endpoint should not fail the whole skin
          // fetch, but an expired JWT must still reach the session's 401 retry.
          getActiveSkin({ baseUrl, token, timeoutMs: 12_000 }).catch(
            (activeError: unknown) => {
              if (isUnauthorizedError(activeError)) throw activeError;
              return null;
            },
          ),
        ]);
        return { list, active: active?.skin ?? null };
      });
      // A node switch clears the skin list in another effect; ignore stale replies.
      if (nodeKeyRef.current !== requestNodeKey) return;
      if (!isSkinArray(result.list)) {
        setSkins([]);
      } else {
        setSkins(result.list);
      }
      setServerActiveSkin(result.active);
    } catch (error) {
      if (nodeKeyRef.current === requestNodeKey) {
        // Keep the last known skins; only surface the message.
        setSkinsError(describeError(error));
      }
    } finally {
      setLoadingSkins(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!nodeKey) {
      setSkins([]);
      setServerActiveSkin(null);
      setSkinsError(null);
      return;
    }
    if (sessionStatus === "online") {
      void refreshSkins();
    }
  }, [nodeKey, ready, refreshSkins, sessionStatus]);

  const resolvedMode: ResolvedMode =
    mode === "system" ? (systemScheme === "light" ? "light" : "dark") : mode;

  const activeSkin = useMemo<Skin | null>(() => {
    if (!skins.length) return null;
    if (preferredSkinId) {
      const preferred = skins.find((skin) => skin.id === preferredSkinId);
      if (preferred) return preferred;
    }
    if (serverActiveSkin) {
      const active = skins.find((skin) => skin.id === serverActiveSkin.id);
      if (active) return active;
      return serverActiveSkin;
    }
    return skins[0] ?? null;
  }, [preferredSkinId, serverActiveSkin, skins]);

  const palette = useMemo(
    () =>
      activeSkin
        ? createPalette(resolvedMode, skinColors(activeSkin, resolvedMode))
        : fallbackPalettes[resolvedMode],
    [activeSkin, resolvedMode],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      ready,
      mode,
      setMode,
      resolvedMode,
      palette,
      skins,
      skinId: preferredSkinId,
      activeSkin,
      setSkinId,
      refreshSkins,
      loadingSkins,
      skinsError,
    }),
    [
      activeSkin,
      loadingSkins,
      mode,
      palette,
      preferredSkinId,
      ready,
      refreshSkins,
      resolvedMode,
      setMode,
      setSkinId,
      skins,
      skinsError,
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